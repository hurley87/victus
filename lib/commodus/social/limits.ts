import { supabaseAdmin } from "@/lib/supabase/server";
import type { SocialCastEvent } from "@/lib/workflows/commodus-social";

export const MAX_THREAD_REPLIES = 3;
export const MAX_AUTHOR_REPLIES_24H = 2;

export interface SocialLimitState {
  blocklisted: boolean;
  blocklistReason?: string | null;
  threadMuted: boolean;
  threadReplyCount: number;
  authorReplyCount24h: number;
}

export type SocialLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "blocklist" | "thread_muted" | "thread_cap" | "author_cap"; riskFlags: string[] };

export function evaluateSocialLimits(state: SocialLimitState): SocialLimitDecision {
  if (state.blocklisted) return { allowed: false, reason: "blocklist", riskFlags: ["blocklist"] };
  if (state.threadMuted) return { allowed: false, reason: "thread_muted", riskFlags: ["thread_muted"] };
  if (state.threadReplyCount >= MAX_THREAD_REPLIES) {
    return { allowed: false, reason: "thread_cap", riskFlags: ["thread_cap"] };
  }
  if (state.authorReplyCount24h >= MAX_AUTHOR_REPLIES_24H) {
    return { allowed: false, reason: "author_cap", riskFlags: ["author_cap"] };
  }
  return { allowed: true };
}

export async function loadSocialLimitState(
  cast: SocialCastEvent,
  now = new Date(),
): Promise<SocialLimitState> {
  const [blocklist, threadMemory, threadReplyCount, authorReplyCount24h] =
    await Promise.all([
      loadBlocklist(cast.author.fid),
      loadThreadMemory(cast.thread_hash ?? cast.hash),
      countThreadReplies(cast.thread_hash ?? cast.hash),
      countAuthorReplies24h(cast.author.fid, now),
    ]);

  return {
    blocklisted: Boolean(blocklist.data),
    blocklistReason: blocklist.data?.reason ?? null,
    threadMuted: Boolean(threadMemory.data?.is_muted),
    threadReplyCount,
    authorReplyCount24h,
  };
}

export async function loadAuthorRelationship(
  fid: number,
): Promise<{ relationship: "ally" | "rival" | "unknown" | "muted"; lastInteractionAt: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("commodus_user_memory")
    .select("relationship,last_interaction_at")
    .eq("fid", fid)
    .maybeSingle();

  if (error) throw new Error(`commodus_user_memory read failed: ${error.message}`);

  const raw = data?.relationship;
  let relationship: "ally" | "rival" | "unknown" | "muted" = "unknown";
  if (raw === "ally" || raw === "rival" || raw === "muted") {
    relationship = raw;
  }

  return {
    relationship,
    lastInteractionAt: data?.last_interaction_at ?? null,
  };
}

async function loadBlocklist(fid: number) {
  const result = await supabaseAdmin
    .from("commodus_social_blocklist")
    .select("reason")
    .eq("fid", fid)
    .maybeSingle();

  if (result.error) throw new Error(`commodus_social_blocklist read failed: ${result.error.message}`);
  return result;
}

async function loadThreadMemory(threadHash: string) {
  const result = await supabaseAdmin
    .from("commodus_thread_memory")
    .select("is_muted")
    .eq("thread_hash", threadHash)
    .maybeSingle();

  if (result.error) throw new Error(`commodus_thread_memory read failed: ${result.error.message}`);
  return result;
}

async function countThreadReplies(threadHash: string): Promise<number> {
  const { data: casts, error: castsError } = await supabaseAdmin
    .from("commodus_casts")
    .select("hash")
    .eq("thread_hash", threadHash);

  if (castsError) throw new Error(`commodus_casts thread read failed: ${castsError.message}`);
  const castHashes = (casts ?? []).map((row) => row.hash);
  if (castHashes.length === 0) return 0;

  const { count, error } = await supabaseAdmin
    .from("commodus_social_runs")
    .select("id", { count: "exact", head: true })
    .eq("action", "reply")
    .in("selected_cast_hash", castHashes);

  if (error) throw new Error(`commodus_social_runs thread count failed: ${error.message}`);
  return count ?? 0;
}

async function countAuthorReplies24h(fid: number, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data: casts, error: castsError } = await supabaseAdmin
    .from("commodus_casts")
    .select("hash")
    .eq("author_fid", fid)
    .gte("first_seen_at", since);

  if (castsError) throw new Error(`commodus_casts author read failed: ${castsError.message}`);
  const castHashes = (casts ?? []).map((row) => row.hash);
  if (castHashes.length === 0) return 0;

  const { count, error } = await supabaseAdmin
    .from("commodus_social_runs")
    .select("id", { count: "exact", head: true })
    .eq("action", "reply")
    .in("selected_cast_hash", castHashes);

  if (error) throw new Error(`commodus_social_runs author count failed: ${error.message}`);
  return count ?? 0;
}
