import "server-only";

import { randomUUID } from "node:crypto";

import { env } from "@/lib/env";
import { evaluateSocialLimits, loadAuthorRelationship, loadSocialLimitState } from "@/lib/commodus/social/limits";
import { rankSocialCast, type SocialRankDecision } from "@/lib/commodus/social/rank";
import { buildCommodusSocialContext } from "@/lib/commodus/social/context";
import { generateCommodusSocialReply } from "@/lib/commodus/social/generate";
import { log } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { classifySocialCast, type SocialCastEvent } from "@/lib/workflows/commodus-social";

type SocialRunRow = Database["public"]["Tables"]["commodus_social_runs"]["Row"];
type SocialCastRow = Database["public"]["Tables"]["commodus_casts"]["Row"];

export type CommodusSocialReplayResult = {
  originalRunId: string | null;
  newRunId: string;
  triggerCastHash: string;
  action: SocialRankDecision["action"];
  reason: string;
  score: number;
  draft: string | null;
  riskFlags: string[];
};

export async function replayCommodusSocialTrigger(
  triggerCastHash: string,
): Promise<CommodusSocialReplayResult> {
  const normalizedHash = triggerCastHash.trim();
  if (!normalizedHash) {
    throw new ReplayInputError("trigger_cast_hash is required");
  }

  const [originalRun, castRow] = await Promise.all([
    loadLatestRun(normalizedHash),
    loadStoredCast(normalizedHash),
  ]);

  if (!castRow) {
    throw new ReplayNotFoundError(`No stored Commodus social cast found for ${normalizedHash}`);
  }

  const cast = castRowToEvent(castRow);
  const decision = classifySocialCast(cast, env.COMMODUS_FID ?? null);
  const runId = `manual-replay:${normalizedHash}:${new Date().toISOString()}:${randomUUID()}`;

  let selectedHash: string | undefined;
  let rank: SocialRankDecision = {
    action: "ignore",
    score: 0,
    reason: `filter:${decision.reason}`,
    riskFlags: [],
  };
  let draft: string | null = null;
  let promptSnapshot: Json | undefined;
  let modelOutput: Json | undefined;

  if (decision.match) {
    selectedHash = cast.hash;
    const [limitState, authorMemory] = await Promise.all([
      loadSocialLimitState(cast),
      loadAuthorRelationship(cast.author.fid),
    ]);
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
  }

  if (decision.match && rank.action === "reply") {
    const context = await buildCommodusSocialContext(cast);
    const generation = await generateCommodusSocialReply(context);
    rank = {
      ...rank,
      action: generation.action,
      reason: generation.reason,
      riskFlags: generation.riskFlags,
    };
    draft = generation.reply;
    promptSnapshot = generation.promptSnapshot;
    modelOutput = generation.modelOutput;
  }

  const inserted = await insertReplayRun({
    runId,
    triggerHash: normalizedHash,
    selectedHash,
    rank,
    promptSnapshot,
    modelOutput,
  });

  log.info("commodus_social_replay", {
    runId: inserted.id,
    triggerHash: normalizedHash,
    action: rank.action,
    reason: rank.reason,
  });

  return {
    originalRunId: originalRun?.id ?? null,
    newRunId: inserted.id,
    triggerCastHash: normalizedHash,
    action: rank.action,
    reason: rank.reason,
    score: rank.score,
    draft,
    riskFlags: rank.riskFlags,
  };
}

async function loadLatestRun(triggerHash: string): Promise<SocialRunRow | null> {
  const { data, error } = await supabaseAdmin
    .from("commodus_social_runs")
    .select("*")
    .eq("trigger_cast_hash", triggerHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`commodus_social_runs replay read failed: ${error.message}`);
  return data ?? null;
}

async function loadStoredCast(triggerHash: string): Promise<SocialCastRow | null> {
  const { data, error } = await supabaseAdmin
    .from("commodus_casts")
    .select("*")
    .eq("hash", triggerHash)
    .maybeSingle();

  if (error) throw new Error(`commodus_casts replay read failed: ${error.message}`);
  return data ?? null;
}

function castRowToEvent(row: SocialCastRow): SocialCastEvent {
  const raw = isRecord(row.raw_json) ? row.raw_json : {};
  const author = isRecord(raw.author) ? raw.author : {};
  const parentAuthor = isRecord(raw.parent_author) ? raw.parent_author : null;

  return {
    hash: row.hash,
    text: row.text,
    thread_hash: row.thread_hash,
    parent_hash: row.parent_hash,
    parent_author: {
      fid: numberOrNull(parentAuthor?.fid) ?? row.parent_author_fid,
    },
    author: {
      fid: row.author_fid,
      username: stringOrNull(author.username),
    },
    mentioned_profiles: mentionedProfiles(raw.mentioned_profiles),
    embeds: embeds(raw.embeds),
  };
}

async function insertReplayRun(params: {
  runId: string;
  triggerHash: string;
  selectedHash?: string;
  rank: SocialRankDecision;
  promptSnapshot?: Json;
  modelOutput?: Json;
}): Promise<SocialRunRow> {
  const { data, error } = await supabaseAdmin
    .from("commodus_social_runs")
    .insert({
      idem_key: params.runId,
      run_type: "manual",
      trigger_cast_hash: params.triggerHash,
      selected_cast_hash: params.selectedHash ?? null,
      action: params.rank.action,
      score: params.rank.score,
      reason: params.rank.reason,
      risk_flags: params.rank.riskFlags as Json,
      prompt_snapshot: params.promptSnapshot ?? {},
      model_output: params.modelOutput ?? {},
    })
    .select("*")
    .single();

  if (error) throw new Error(`commodus_social_runs replay insert failed: ${error.message}`);
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mentionedProfiles(value: unknown): SocialCastEvent["mentioned_profiles"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((profile) => (isRecord(profile) ? { fid: numberOrNull(profile.fid) } : null))
    .filter((profile): profile is { fid: number } => profile?.fid != null);
}

function embeds(value: unknown): SocialCastEvent["embeds"] {
  if (!Array.isArray(value)) return [];
  return value.map((embed) => {
    if (!isRecord(embed)) return {};
    const castId = isRecord(embed.cast_id) ? embed.cast_id : null;
    let cast_id: { hash?: string; fid?: number } | null = null;
    if (castId) {
      cast_id = {
        hash: stringOrNull(castId.hash) ?? undefined,
        fid: numberOrNull(castId.fid) ?? undefined,
      };
    }
    return {
      url: stringOrNull(embed.url) ?? undefined,
      cast_id,
    };
  });
}

export class ReplayInputError extends Error {}
export class ReplayNotFoundError extends Error {}
