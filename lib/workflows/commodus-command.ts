import { FatalError } from "workflow";

import {
  parseCommand,
  type ParseResult,
} from "@/lib/commodus/parser";
import {
  buildAcceptedReply,
  REJECTION_REPLIES,
  rejectionReasonForParse,
  type RejectionReason,
} from "@/lib/commodus/templates";
import { MissingSignerError, publishReplyCast } from "@/lib/neynar";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Payload forwarded from the Neynar `cast.created` webhook into the workflow.
 * Kept narrow on purpose: anything extra should be fetched lazily inside a
 * step so the event log stays small and serializable.
 */
export interface CommandContext {
  castHash: string;
  /** FID of the user who mentioned the bot. */
  authorFid: number;
  /** Raw cast text (what the user typed). */
  text: string;
  /** Optional parent cast hash if this is a reply. */
  parentHash: string | null;
}

type TerminalStatus = "parsed" | "rejected";

/** Statuses the row must NOT already be in for an update to apply. */
const TERMINAL_STATUSES = "(executed,failed,rejected)";

/**
 * A single idempotency-key shape for any outcome on a given cast. At most
 * one branch fires per cast (parse is deterministic; DB state is terminal-
 * guarded), so one generic key is correct and prevents Neynar from double-
 * publishing if the workflow step retries across a brief outage.
 */
function replyIdemKey(castHash: string): string {
  return `reply:${castHash}:result`;
}

/**
 * Top-level workflow for a Commodus mention.
 *
 * Pipeline (issue #6):
 *   parse → arena-wallet lookup → asset check → size-cap check → record + reply
 *
 * Exactly one templated reply is published per cast. The tracer reply
 * (`tracer:{castHash}`) has been retired.
 *
 * Execution, scoring, and outcome replies are intentionally out of scope
 * here — see #7 onward.
 */
export async function handleCommodusCommand(ctx: CommandContext) {
  "use workflow";

  const parseResult = parseCommand(ctx.text);

  if (parseResult.kind !== "ok") {
    const reason = rejectionReasonForParse(parseResult);
    await recordRejection(ctx.castHash, reason, parseResult);
    await publishOutcomeReply(ctx.castHash, REJECTION_REPLIES[reason]);
    return { status: "rejected" as const, reason };
  }

  const walletId = await findArenaWalletIdByFid(ctx.authorFid);

  if (!walletId) {
    await recordRejection(ctx.castHash, "no_arena_wallet", parseResult);
    await publishOutcomeReply(
      ctx.castHash,
      REJECTION_REPLIES.no_arena_wallet,
    );
    return { status: "rejected" as const, reason: "no_arena_wallet" as const };
  }

  await recordAccepted(ctx.castHash, parseResult, walletId);
  await publishOutcomeReply(
    ctx.castHash,
    buildAcceptedReply(parseResult.amount),
  );
  return { status: "accepted" as const, amount: parseResult.amount };
}

/**
 * Resolve the author's arena wallet via `farcaster_accounts.fid → user_id
 * → arena_wallets.user_id`. There is no `fid` column on `arena_wallets`,
 * so this is the only valid path.
 *
 * Returns `null` if the author has no Farcaster row or no arena wallet —
 * the two "no arena wallet" shapes collapse to the same user-facing reply.
 */
async function findArenaWalletIdByFid(fid: number): Promise<string | null> {
  "use step";

  const { data: farcaster, error: farcasterError } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id")
    .eq("fid", fid)
    .maybeSingle();

  if (farcasterError) {
    throw new Error(
      `farcaster_accounts lookup failed: ${farcasterError.message}`,
    );
  }
  if (!farcaster) {
    return null;
  }

  const { data: wallet, error: walletError } = await supabaseAdmin
    .from("arena_wallets")
    .select("id")
    .eq("user_id", farcaster.user_id)
    .maybeSingle();

  if (walletError) {
    throw new Error(`arena_wallets lookup failed: ${walletError.message}`);
  }

  return wallet?.id ?? null;
}

/**
 * Record a rejection on `cast_commands`. Also persists whatever parsed
 * fields were recovered — an asset-reject knows the user typed `buy`, an
 * oversize-reject knows the amount, etc. — so the audit log is useful.
 *
 * Respects the terminal-status guard: if the row is already `executed`,
 * `failed`, or `rejected`, the update is a no-op. That makes workflow
 * retries safe.
 */
async function recordRejection(
  castHash: string,
  reason: RejectionReason,
  parseResult: ParseResult,
): Promise<void> {
  "use step";

  await updateCastCommand(castHash, {
    status: "rejected",
    errorReason: reason,
    parsed: parsedFieldsFor(parseResult),
  });
}

/**
 * Record an accepted command: update `cast_commands` with parsed fields
 * and `status='parsed'`, then insert the `trade_intents` row. The intent's
 * `cast_command_id` FK is `unique`, so a retry that reaches this step after
 * the first attempt succeeded is caught by the PK constraint and treated
 * as a no-op.
 */
async function recordAccepted(
  castHash: string,
  parsed: Extract<ParseResult, { kind: "ok" }>,
  walletId: string,
): Promise<void> {
  "use step";

  const updated = await updateCastCommand(castHash, {
    status: "parsed",
    errorReason: null,
    parsed: {
      action: parsed.action,
      symbol: parsed.symbol,
      amount: parsed.amount,
    },
  });

  if (!updated) {
    // Terminal-status guard blocked the update — a prior run already
    // handled this cast. Don't try to insert an intent row either; the
    // first run will have done so (or moved it past `parsed`).
    return;
  }

  const { error } = await supabaseAdmin.from("trade_intents").insert({
    cast_command_id: updated.id,
    wallet_id: walletId,
    action: parsed.action,
    asset_symbol: parsed.symbol,
    amount_type: "usdc_in",
    amount_value: parsed.amount,
    status: "pending",
  });

  if (!error) return;

  // Unique-violation on `cast_command_id` → another run already inserted
  // the intent. Idempotent success.
  if (isUniqueViolation(error)) return;

  throw new Error(`trade_intents insert failed: ${error.message}`);
}

/**
 * Publish the outcome reply. Shares one idempotency key across all five
 * outcomes because exactly one outcome fires per cast.
 *
 * Missing signer config is a configuration error, not a transient one —
 * promote to `FatalError` so the workflow runtime doesn't retry 6×.
 */
async function publishOutcomeReply(
  parentCastHash: string,
  text: string,
): Promise<void> {
  "use step";

  try {
    await publishReplyCast(parentCastHash, text, replyIdemKey(parentCastHash));
  } catch (err) {
    if (err instanceof MissingSignerError) {
      throw new FatalError(err.message);
    }
    throw err;
  }
}

/** Shared core for both rejection and acceptance updates on `cast_commands`. */
async function updateCastCommand(
  castHash: string,
  patch: {
    status: TerminalStatus;
    errorReason: RejectionReason | null;
    parsed: ParsedFields | null;
  },
): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("cast_commands")
    .update({
      status: patch.status,
      error_reason: patch.errorReason,
      parsed_action: patch.parsed?.action ?? null,
      parsed_symbol: patch.parsed?.symbol ?? null,
      parsed_amount: patch.parsed?.amount ?? null,
    })
    .eq("cast_hash", castHash)
    .not("status", "in", TERMINAL_STATUSES)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`cast_commands update failed: ${error.message}`);
  }

  return data;
}

interface ParsedFields {
  action: "buy";
  symbol: string;
  amount: number;
}

/**
 * Extract the `parsed_*` fields to persist for a given parse outcome.
 * Grammar rejections know nothing structural; everything else knows at
 * least `action='buy'` and the amount.
 */
function parsedFieldsFor(result: ParseResult): ParsedFields | null {
  switch (result.kind) {
    case "grammar_error":
      return null;
    case "asset_error":
      return {
        action: result.action,
        symbol: result.attemptedSymbol,
        amount: result.amount,
      };
    case "oversize_error":
    case "ok":
      return {
        action: result.action,
        symbol: result.symbol,
        amount: result.amount,
      };
  }
}

/**
 * Detect Postgres unique-violation (SQLSTATE `23505`) on a Supabase error.
 * Supabase's PostgrestError exposes `.code`; we match it with a narrow
 * duck-type to avoid importing types from the SDK.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
