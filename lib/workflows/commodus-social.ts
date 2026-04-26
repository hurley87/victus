import { env } from "@/lib/env";
import { buildCommodusSocialContext } from "@/lib/commodus/social/context";
import { generateCommodusSocialReply } from "@/lib/commodus/social/generate";
import { evaluateSocialLimits, loadAuthorRelationship, loadSocialLimitState } from "@/lib/commodus/social/limits";
import { rankSocialCast, type SocialRankDecision } from "@/lib/commodus/social/rank";
import { log } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

/** Neynar cast fields needed for social filtering; kept separate from trade ingress types. */
export interface SocialCastEvent {
  hash: string;
  text: string;
  thread_hash?: string | null;
  parent_hash: string | null;
  parent_author?: { fid: number | null } | null;
  author: { fid: number; username?: string | null };
  mentioned_profiles?: Array<{ fid: number }> | null;
  embeds?: Array<{ url?: string; cast_id?: { hash?: string; fid?: number } | null }> | null;
}

export interface SocialEngagementContext {
  /** Precomputed in Node ingress; workflows cannot import `node:crypto`. */
  runId: string;
  triggerHash: string;
  runType: "webhook" | "manual";
  cast: SocialCastEvent;
}

type FilterDecision =
  | { match: true; reason: "reply_to_commodus" | "mention" }
  | { match: false; reason: "self_cast" | "quote_cast" | "unrelated" };

/** Replies to or mentions of Commodus; skips quotes, self-casts, and missing FID config. */
export function classifySocialCast(
  cast: SocialCastEvent,
  commodusFid: number | null | undefined,
): FilterDecision {
  if (!commodusFid) return { match: false, reason: "unrelated" };
  if (cast.author.fid === commodusFid) return { match: false, reason: "self_cast" };

  const isQuoteCast = (cast.embeds ?? []).some(
    (embed) => embed?.cast_id?.hash != null,
  );
  if (isQuoteCast) return { match: false, reason: "quote_cast" };

  const parentFid = cast.parent_author?.fid ?? null;
  if (parentFid === commodusFid) return { match: true, reason: "reply_to_commodus" };

  const mentioned = cast.mentioned_profiles ?? [];
  if (mentioned.some((profile) => profile?.fid === commodusFid)) {
    return { match: true, reason: "mention" };
  }

  return { match: false, reason: "unrelated" };
}

/** Matching casts are upserted to `commodus_casts`; every path lands `commodus_social_runs` (idem_key UNIQUE + ignoreDuplicates). */
export async function handleSocialEngagement(ctx: SocialEngagementContext) {
  "use workflow";

  const { runId, runType, triggerHash, cast } = ctx;
  const decision = classifySocialCast(cast, env.COMMODUS_FID ?? null);
  const runBase = { runId, runType, triggerHash };

  let reason: string;
  let logEvent: "social_filter_skip" | "social_filter_match";
  let selectedHash: string | undefined;
  let rank: SocialRankDecision = {
    action: "ignore",
    score: 0,
    reason: `filter:${decision.reason}`,
    riskFlags: [],
  };

  if (decision.match) {
    await persistInboundCast(cast, runId);
    selectedHash = cast.hash;
    const { limitState, authorMemory } = await loadSocialGateInputs(cast);
    const limitDecision = evaluateSocialLimits(limitState);
    if (limitDecision.allowed) {
      rank = rankSocialCast({
        cast,
        trigger: decision.reason,
        relationship: authorMemory.relationship,
        lastCommodusReplyAt: authorMemory.lastInteractionAt,
      });
    } else {
      rank = {
        action: "ignore",
        score: 0,
        reason: limitDecision.reason,
        riskFlags: limitDecision.riskFlags,
      };
    }
    reason = rank.reason;
    logEvent = "social_filter_match";
  } else {
    reason = `filter:${decision.reason}`;
    logEvent = "social_filter_skip";
  }

  if (decision.match && rank.action === "reply") {
    const generation = await generateSocialDraft(cast);
    rank = {
      ...rank,
      action: generation.action,
      reason: generation.reason,
      riskFlags: generation.riskFlags,
    };
    reason = generation.reason;
    await landRun({
      ...runBase,
      selectedHash,
      rank,
      reason,
      logEvent,
      promptSnapshot: generation.promptSnapshot,
      modelOutput: generation.modelOutput,
    });
  } else {
    await landRun({ ...runBase, selectedHash, rank, reason, logEvent });
  }

  return { status: "ranked" as const, action: rank.action, reason };
}

async function loadSocialGateInputs(cast: SocialCastEvent) {
  "use step";

  const [limitState, authorMemory] = await Promise.all([
    loadSocialLimitState(cast),
    loadAuthorRelationship(cast.author.fid),
  ]);

  return { limitState, authorMemory };
}

async function persistInboundCast(cast: SocialCastEvent, runId: string) {
  "use step";

  const { error } = await supabaseAdmin.from("commodus_casts").upsert(
    {
      hash: cast.hash,
      thread_hash: cast.thread_hash ?? cast.hash,
      parent_hash: cast.parent_hash,
      parent_author_fid: cast.parent_author?.fid ?? null,
      author_fid: cast.author.fid,
      text: cast.text,
      source: "webhook",
      raw_json: cast as unknown as Json,
    },
    { onConflict: "hash", ignoreDuplicates: true },
  );

  assertUpsertOk("commodus_casts_upsert_failed", "commodus_casts upsert", error, {
    runId,
    castHash: cast.hash,
  });
}

async function generateSocialDraft(cast: SocialCastEvent) {
  "use step";

  const context = await buildCommodusSocialContext(cast);
  const generation = await generateCommodusSocialReply(context);

  if (!env.COMMODUS_SOCIAL_DRY_RUN && generation.action === "reply") {
    return {
      ...generation,
      action: "ignore" as const,
      reason: "dry_run_required",
      riskFlags: ["dry_run_required"],
    };
  }

  return generation;
}

async function landRun(params: {
  runId: string;
  runType: SocialEngagementContext["runType"];
  triggerHash: string;
  selectedHash?: string;
  rank: SocialRankDecision;
  reason: string;
  logEvent: "social_filter_skip" | "social_filter_match";
  promptSnapshot?: Json;
  modelOutput?: Json;
}) {
  "use step";

  const { error } = await supabaseAdmin.from("commodus_social_runs").upsert(
    {
      idem_key: params.runId,
      run_type: params.runType,
      trigger_cast_hash: params.triggerHash,
      selected_cast_hash: params.selectedHash ?? null,
      action: params.rank.action,
      score: params.rank.score,
      reason: params.reason,
      risk_flags: params.rank.riskFlags as Json,
      prompt_snapshot: params.promptSnapshot ?? {},
      model_output: params.modelOutput ?? {},
    },
    { onConflict: "idem_key", ignoreDuplicates: true },
  );

  assertUpsertOk(
    "commodus_social_runs_upsert_failed",
    "commodus_social_runs upsert",
    error,
    { runId: params.runId },
  );

  log.info(params.logEvent, {
    runId: params.runId,
    castHash: params.triggerHash,
    reason: params.reason,
    agent: "commodus-social",
  });
}

type SupabaseWriteError = { message: string; code?: string } | null;

function assertUpsertOk(
  logEvent: string,
  throwPrefix: string,
  error: SupabaseWriteError,
  context: Record<string, unknown>,
): void {
  if (!error) return;
  log.error(logEvent, { ...context, err: error.message, code: error.code });
  throw new Error(`${throwPrefix}: ${error.message}`);
}
