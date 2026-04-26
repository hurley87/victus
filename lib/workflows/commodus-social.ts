import crypto from "node:crypto";

import { env } from "@/lib/env";
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

export function deriveIdemKey(
  triggerHash: string,
  runType: SocialEngagementContext["runType"],
): string {
  return crypto
    .createHash("sha256")
    .update(`${triggerHash}:${runType}`)
    .digest("hex");
}

/**
 * Phase-1: persist matching casts and land `commodus_social_runs` with `action='ignore'`.
 * Idempotency: `idem_key` UNIQUE + `ignoreDuplicates` on upsert.
 */
export async function handleSocialEngagement(ctx: SocialEngagementContext) {
  "use workflow";

  const runId = deriveIdemKey(ctx.triggerHash, ctx.runType);
  const lg = log.child({ runId, castHash: ctx.triggerHash, agent: "commodus-social" });

  const decision = classifySocialCast(ctx.cast, env.COMMODUS_FID ?? null);

  if (!decision.match) {
    lg.info("social_filter_skip", { reason: decision.reason });
    await landRun({
      runId,
      runType: ctx.runType,
      triggerHash: ctx.triggerHash,
      reason: `filter:${decision.reason}`,
    });
    return { status: "ignored" as const, reason: decision.reason };
  }

  await persistInboundCast(ctx.cast);
  await landRun({
    runId,
    runType: ctx.runType,
    triggerHash: ctx.triggerHash,
    selectedHash: ctx.cast.hash,
    reason: `accepted:${decision.reason}`,
  });

  lg.info("social_filter_match", { reason: decision.reason });
  return { status: "ignored" as const, reason: decision.reason };
}

async function persistInboundCast(cast: SocialCastEvent) {
  "use step";

  const { error } = await supabaseAdmin.from("commodus_casts").upsert(
    {
      hash: cast.hash,
      thread_hash: cast.thread_hash ?? null,
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
    castHash: cast.hash,
  });
}

async function landRun(params: {
  runId: string;
  runType: SocialEngagementContext["runType"];
  triggerHash: string;
  selectedHash?: string;
  reason: string;
}) {
  "use step";

  const { error } = await supabaseAdmin.from("commodus_social_runs").upsert(
    {
      idem_key: params.runId,
      run_type: params.runType,
      trigger_cast_hash: params.triggerHash,
      selected_cast_hash: params.selectedHash ?? null,
      action: "ignore",
      reason: params.reason,
    },
    { onConflict: "idem_key", ignoreDuplicates: true },
  );

  assertUpsertOk(
    "commodus_social_runs_upsert_failed",
    "commodus_social_runs upsert",
    error,
    { runId: params.runId },
  );
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
