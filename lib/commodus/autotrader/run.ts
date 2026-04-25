import "server-only";

import { env } from "@/lib/env";
import { isTradeIntent, type TradeIntent } from "@/lib/execution/intents";
import { validatePolicy, type PolicyRejectionReason } from "@/lib/execution/policy";
import { log } from "@/lib/logger";
import { publishCast, MissingSignerError } from "@/lib/neynar";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { ZeroxNotConfiguredError } from "@/lib/zerox/quote";

import { decideCommodusAction } from "./decision";
import { executeCommodusAutotrade } from "./execute";
import { narrateCommodusOutcome } from "./narrate";
import { loadCommodusPlayer } from "./player";
import { reserveAutotraderRun } from "./reserve";
import { buildCommodusMarketSnapshot } from "./snapshot";
import type {
  CommodusAnalysisForNarration,
  CommodusAutotraderDecision,
  CommodusAutotraderStatus,
  CommodusPlayer,
} from "./types";

type CommodusAutotraderRunUpdate =
  Database["public"]["Tables"]["commodus_autotrader_runs"]["Update"];

export type CommodusAutotradeRunResult = {
  status: CommodusAutotraderStatus | "not_provisioned" | "skipped";
  slotKey: string;
  runId?: string;
  message?: string;
  publishedCastHash?: string;
};

function syntheticCastHash(slotKey: string): string {
  return `commodus-auto:${slotKey}`;
}

export async function runCommodusAutotrader(params: {
  slotKey: string;
  dryRun: boolean;
  now?: Date;
}): Promise<CommodusAutotradeRunResult> {
  const { slotKey, dryRun } = params;
  const now = params.now ?? new Date();
  const nowMs = now.getTime();

  const { runId, existingStatus, skip: skipAsDone } = await reserveAutotraderRun(slotKey);
  if (skipAsDone) {
    return { status: "skipped", slotKey, runId, message: `run terminal: ${existingStatus}` };
  }

  const player = await loadCommodusPlayer();
  if (!player) {
    await updateRunRow(runId, { status: "failed", error: "commodus not provisioned" });
    return { status: "not_provisioned", slotKey, runId, message: "Call POST /api/admin/commodus/bootstrap once" };
  }

  if (env.COMMODUS_FID != null && player.fid !== Number(env.COMMODUS_FID)) {
    log.error("commodus_fid_mismatch", { expected: env.COMMODUS_FID, got: player.fid });
  }

  let snapshot;
  try {
    snapshot = await buildCommodusMarketSnapshot(player);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateRunRow(runId, { status: "failed", error: msg });
    return { status: "failed", slotKey, runId, message: msg };
  }

  const decision = decideCommodusAction({ snapshot, slotKey, nowMs });
  const slotDate = slotKey.split(":")[1] ?? now.toISOString().slice(0, 10);
  const baseAnalysis: Omit<CommodusAnalysisForNarration, "kind"> = {
    slotKey,
    slotDate,
    decision,
    trace: `decision=${decision.action} engine=v1`,
  };

  if (dryRun) {
    await updateRunRow(runId, {
      status: "dry_run",
      analysis: { decision, snapshotSummary: { usdc: snapshot.usdcCash, positions: snapshot.positions.length } },
    });
    return { status: "dry_run", slotKey, runId, message: "no trade, no post" };
  }

  if (decision.action === "hold") {
    const text = await narrateCommodusOutcome({
      kind: "hold",
      ...baseAnalysis,
    });
    const hash = await safePublishCast(text, slotKey, runId);
    await updateRunRow(runId, {
      status: "hold_posted",
      published_cast_hash: hash,
      analysis: { decision, narrative: text },
    });
    return { status: "hold_posted", slotKey, runId, publishedCastHash: hash };
  }

  const intent: TradeIntent = decision.intent;
  const policy = await validatePolicy({
    userId: player.userId,
    walletId: player.walletId,
    walletAddress: player.walletAddress,
    privyWalletId: player.privyWalletId,
    intent,
  });

  if (!policy.ok) {
    const analysis = buildPolicyHoldNarration(
      { ...baseAnalysis, kind: "hold" },
      policy.reason,
    );
    const text = await narrateCommodusOutcome(analysis);
    const hash = await safePublishCast(text, slotKey, runId);
    await updateRunRow(runId, {
      status: "hold_posted",
      published_cast_hash: hash,
      analysis: {
        decision: { action: "hold" as const, reason: "policy", policyReason: policy.reason },
        intendedIntent: intent,
        narrative: text,
      },
    });
    return { status: "hold_posted", slotKey, runId, publishedCastHash: hash, message: policy.reason };
  }

  const policyCtx = policy.context;
  const castHash = syntheticCastHash(slotKey);
  const castCommandId = await insertCastCommand({
    player,
    castHash,
    intent,
    slotKey,
    decision,
  });
  if (!castCommandId) {
    const msg = "cast_commands insert failed";
    await updateRunRow(runId, { status: "failed", error: msg });
    return { status: "failed", slotKey, runId, message: msg };
  }

  await updateCastCommandRow(castCommandId, { status: "validated" });

  let exec;
  try {
    exec = await executeCommodusAutotrade({
      castHash,
      castCommandId,
      userId: player.userId,
      policyCtx,
      intent,
    });
  } catch (err) {
    if (err instanceof ZeroxNotConfiguredError) {
      if (castCommandId) {
        await updateCastCommandRow(castCommandId, {
          status: "rejected",
          error_reason: "zerox_not_configured",
        });
      }
      const text = await narrateCommodusOutcome(
        buildFailureAnalysis(baseAnalysis, "quote_unavailable"),
      );
      const hash = await safePublishCast(text, slotKey, runId);
      await updateRunRow(runId, {
        status: "hold_posted",
        published_cast_hash: hash,
        error: err.message,
        analysis: { err: "zerox" },
        cast_command_id: castCommandId,
      });
      return { status: "hold_posted", slotKey, runId, publishedCastHash: hash, message: err.message };
    }
    const m = err instanceof Error ? err.message : String(err);
    if (castCommandId) {
      await updateCastCommandRow(castCommandId, {
        status: "failed",
        error_reason: m.slice(0, 200),
      });
    }
    const text = await narrateCommodusOutcome(buildFailureAnalysis(baseAnalysis, m));
    const hash = await safePublishCast(text, slotKey, runId);
    await updateRunRow(runId, {
      status: "failed",
      error: m,
      cast_command_id: castCommandId,
      published_cast_hash: hash,
      analysis: { failure: m },
    });
    return { status: "failed", slotKey, runId, publishedCastHash: hash, message: m };
  }

  if (!exec.ok) {
    await updateCastCommandRow(castCommandId, {
      status: "failed",
      error_reason: exec.reason,
    });
    const analysis: CommodusAnalysisForNarration = {
      kind: "hold_failed",
      ...baseAnalysis,
      decision: { action: "hold", reason: exec.reason, bestBuy: null, bestSell: null },
    };
    const text = await narrateCommodusOutcome(analysis);
    const hash = await safePublishCast(text, slotKey, runId);
    await updateRunRow(runId, {
      status: "hold_posted",
      cast_command_id: castCommandId,
      trade_execution_id: exec.tradeExecutionId,
      published_cast_hash: hash,
      analysis: { decision, execFailure: exec.reason, narrative: text },
    });
    return { status: "hold_posted", slotKey, runId, publishedCastHash: hash, message: exec.reason };
  }

  const fill = {
    txHash: exec.txHash,
    symbol: exec.symbol,
    action: exec.action,
    notionalUsdc: exec.notionalUsdc,
  };
  const narrativeIn: CommodusAnalysisForNarration = {
    kind: exec.action === "buy" ? "buy" : "sell",
    ...baseAnalysis,
    fill,
  };
  const text = await narrateCommodusOutcome(narrativeIn);
  const hash = await safePublishCast(text, slotKey, runId);
  await updateRunRow(runId, {
    status: "executed",
    cast_command_id: castCommandId,
    trade_execution_id: exec.tradeExecutionId,
    published_cast_hash: hash,
    analysis: { decision, fill, narrative: text },
  });
  return { status: "executed", slotKey, runId, publishedCastHash: hash };
}

export { reserveAutotraderRun };

async function updateCastCommandRow(
  id: string,
  row: { status: string; error_reason?: string | null },
): Promise<void> {
  await supabaseAdmin.from("cast_commands").update(row).eq("id", id);
}

async function updateRunRow(
  id: string,
  patch: {
    status?: CommodusAutotraderStatus;
    error?: string | null;
    analysis?: Json;
    published_cast_hash?: string | null;
    cast_command_id?: string;
    trade_execution_id?: string;
  },
): Promise<void> {
  const row: CommodusAutotraderRunUpdate = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.error !== undefined) row.error = patch.error;
  if (patch.analysis !== undefined) row.analysis = patch.analysis;
  if (patch.published_cast_hash !== undefined) row.published_cast_hash = patch.published_cast_hash;
  if (patch.cast_command_id !== undefined) row.cast_command_id = patch.cast_command_id;
  if (patch.trade_execution_id !== undefined) row.trade_execution_id = patch.trade_execution_id;

  const { error } = await supabaseAdmin.from("commodus_autotrader_runs").update(row).eq("id", id);
  if (error) {
    log.error("commodus_update_run_failed", { id, err: error.message });
  }
}

function buildPolicyHoldNarration(
  base: CommodusAnalysisForNarration,
  reason: PolicyRejectionReason,
): CommodusAnalysisForNarration {
  return {
    ...base,
    kind: "hold",
    policyRejection: reason,
    decision: {
      action: "hold",
      reason: `policy:${reason}`,
      bestBuy: null,
      bestSell: null,
    },
  };
}

function buildFailureAnalysis(
  base: Omit<CommodusAnalysisForNarration, "kind">,
  err: string,
): CommodusAnalysisForNarration {
  return {
    kind: "hold_failed",
    ...base,
    decision: { action: "hold", reason: err, bestBuy: null, bestSell: null },
  };
}

async function insertCastCommand(params: {
  player: CommodusPlayer;
  castHash: string;
  intent: TradeIntent;
  slotKey: string;
  decision: CommodusAutotraderDecision;
}): Promise<string | null> {
  const { player, castHash, intent, slotKey, decision } = params;
  if (!isTradeIntent(intent)) return null;

  const { data: existing } = await supabaseAdmin
    .from("cast_commands")
    .select("id")
    .eq("cast_hash", castHash)
    .maybeSingle();
  if (existing?.id) {
    return existing.id;
  }

  const body = {
    slotKey,
    decision: decision.action,
    version: 1,
  };
  const row = {
    fid: player.fid,
    cast_hash: castHash,
    text: JSON.stringify(body),
    parsed_action: intent.action,
    parsed_symbol: intent.symbol,
    parsed_amount: intent.action === "buy" ? intent.amount_value : null,
    parsed_percent: intent.action === "sell" ? intent.amount_value : null,
    status: "received",
  } as const;

  const { data, error } = await supabaseAdmin.from("cast_commands").insert(row).select("id").single();
  if (error) {
    log.error("commodus_cast_command_insert", { err: error.message });
    return null;
  }
  return data?.id ?? null;
}

async function safePublishCast(
  text: string,
  idemKey: string,
  runId: string,
): Promise<string> {
  if (!text.trim()) {
    return "skipped_empty";
  }
  try {
    const cast = await publishCast(text, idemKey);
    return cast.hash;
  } catch (err) {
    if (err instanceof MissingSignerError) {
      await updateRunRow(runId, { error: "missing NEYNAR_SIGNER_UUID" });
      throw err;
    }
    log.error("commodus_cast_publish", { err: err instanceof Error ? err.message : String(err) });
    return "publish_failed";
  }
}

/**
 * @returns slot key `commodus-autotrade:YYYY-MM-DD:slot-1`
 */
export function defaultDailySlotKey(now: Date = new Date()): string {
  return `commodus-autotrade:${now.toISOString().slice(0, 10)}:slot-1`;
}
