import "server-only";

import { start } from "workflow/api";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

const THREAD_CAST_LIMIT = 100;
const USER_CAST_LIMIT = 100;

const CAST_MEMORY_SELECT =
  "hash,thread_hash,parent_hash,parent_author_fid,author_fid,text,source,created_at" as const;

type MemoryCastRow = {
  hash: string;
  thread_hash: string;
  parent_hash: string | null;
  parent_author_fid: number | null;
  author_fid: number;
  text: string;
  source: string;
  created_at: string | null;
};

type UserMemoryRow = {
  relationship: string;
};

export type CommodusMemoryRefreshTarget = {
  threadHash: string;
  fid: number;
  lastCastHash: string;
};

export type CommodusMemoryRefreshResult = {
  thread: MemoryUpsertResult;
  user: MemoryUpsertResult;
};

type MemoryUpsertResult =
  | { status: "updated"; key: string; summary: string }
  | { status: "skipped"; key: string; reason: string };

type SupabaseError = { message: string } | null;

export async function scheduleCommodusSocialMemoryRefresh(
  target: CommodusMemoryRefreshTarget,
): Promise<{ runId: string }> {
  const run = await start(runCommodusSocialMemoryRefresh, [target]);

  return { runId: run.runId };
}

export async function runCommodusSocialMemoryRefresh(
  target: CommodusMemoryRefreshTarget,
): Promise<CommodusMemoryRefreshResult> {
  "use workflow";

  return refreshCommodusSocialMemory(target);
}

async function refreshCommodusSocialMemory(
  target: CommodusMemoryRefreshTarget,
): Promise<CommodusMemoryRefreshResult> {
  "use step";

  const [thread, user] = await Promise.all([
    refreshThreadMemory(target.threadHash),
    refreshUserMemory(target.fid),
  ]);

  return { thread, user };
}

export async function refreshThreadMemory(
  threadHash: string,
): Promise<MemoryUpsertResult> {
  const casts = await loadThreadCasts(threadHash);
  const selfPosts = casts.filter((cast) => cast.source === "self");

  if (selfPosts.length < 2) {
    return {
      status: "skipped",
      key: threadHash,
      reason: "self_posts_below_threshold",
    };
  }

  const lastCast = casts.at(-1);
  if (!lastCast) {
    return { status: "skipped", key: threadHash, reason: "no_casts" };
  }

  const participants = Array.from(
    new Set(casts.map((cast) => cast.author_fid).filter(validFid)),
  );
  const summary = summarizeThread(casts);

  const { error } = await supabaseAdmin.from("commodus_thread_memory").upsert(
    {
      thread_hash: threadHash,
      summary,
      last_cast_hash: lastCast.hash,
      participants: participants as Json,
    },
    { onConflict: "thread_hash" },
  );
  assertOk("commodus_thread_memory upsert", error);

  return { status: "updated", key: threadHash, summary };
}

export async function refreshUserMemory(fid: number): Promise<MemoryUpsertResult> {
  const casts = await loadUserRelevantCasts(fid);
  const selfReplies = casts.filter(
    (cast) => cast.source === "self" && cast.parent_author_fid === fid,
  );

  if (selfReplies.length < 2) {
    return {
      status: "skipped",
      key: String(fid),
      reason: "replies_below_threshold",
    };
  }

  const existing = await loadExistingUserMemory(fid);
  const relationship = existing?.relationship ?? "unknown";
  const summary = summarizeUser(fid, casts, selfReplies);
  const lastInteractionAt = latestTimestamp(casts) ?? new Date().toISOString();

  const { error } = await supabaseAdmin.from("commodus_user_memory").upsert(
    {
      fid,
      summary,
      relationship,
      last_interaction_at: lastInteractionAt,
    },
    { onConflict: "fid" },
  );
  assertOk("commodus_user_memory upsert", error);

  return { status: "updated", key: String(fid), summary };
}

export async function rebuildCommodusSocialMemoryFromCasts(): Promise<{
  threads: MemoryUpsertResult[];
  users: MemoryUpsertResult[];
}> {
  const { data, error } = await supabaseAdmin
    .from("commodus_casts")
    .select("thread_hash,parent_author_fid,source")
    .eq("source", "self")
    .limit(10_000);
  assertOk("commodus_casts rebuild read", error);

  const selfRows = (data ?? []) as Array<{
    thread_hash: string;
    parent_author_fid: number | null;
    source: string;
  }>;

  const threadHashes = Array.from(
    new Set(selfRows.map((row) => row.thread_hash).filter(Boolean)),
  );
  const fids = Array.from(
    new Set(selfRows.map((row) => row.parent_author_fid).filter(validFid)),
  );

  const threads = [];
  for (const threadHash of threadHashes) {
    threads.push(await refreshThreadMemory(threadHash));
  }

  const users = [];
  for (const fid of fids) {
    users.push(await refreshUserMemory(fid));
  }

  return { threads, users };
}

async function loadThreadCasts(threadHash: string): Promise<MemoryCastRow[]> {
  const { data, error } = await supabaseAdmin
    .from("commodus_casts")
    .select(CAST_MEMORY_SELECT)
    .eq("thread_hash", threadHash)
    .order("created_at", { ascending: true })
    .limit(THREAD_CAST_LIMIT);
  assertOk("commodus_casts thread memory read", error);
  return (data ?? []) as MemoryCastRow[];
}

async function loadUserRelevantCasts(fid: number): Promise<MemoryCastRow[]> {
  const { data, error } = await supabaseAdmin
    .from("commodus_casts")
    .select(CAST_MEMORY_SELECT)
    .or(`author_fid.eq.${fid},parent_author_fid.eq.${fid}`)
    .order("created_at", { ascending: true })
    .limit(USER_CAST_LIMIT);
  assertOk("commodus_casts user memory read", error);
  return (data ?? []) as MemoryCastRow[];
}

async function loadExistingUserMemory(fid: number): Promise<UserMemoryRow | null> {
  const { data, error } = await supabaseAdmin
    .from("commodus_user_memory")
    .select("relationship")
    .eq("fid", fid)
    .maybeSingle();
  assertOk("commodus_user_memory relationship read", error);
  return (data ?? null) as UserMemoryRow | null;
}

function summarizeThread(casts: MemoryCastRow[]): string {
  const selfCount = casts.filter((cast) => cast.source === "self").length;
  const participants = Array.from(new Set(casts.map((cast) => cast.author_fid)));
  const recent = casts.slice(-6).map(formatCastBeat).join(" ");

  return compactPlainText(
    `Thread has ${casts.length} tracked casts from FIDs ${participants.join(", ")}. Commodus has posted ${selfCount} times in this thread. Recent beats: ${recent}`,
  );
}

function summarizeUser(
  fid: number,
  casts: MemoryCastRow[],
  selfReplies: MemoryCastRow[],
): string {
  const userCasts = casts.filter((cast) => cast.author_fid === fid);
  const recent = casts.slice(-6).map(formatCastBeat).join(" ");

  return compactPlainText(
    `FID ${fid} has ${userCasts.length} tracked casts around Commodus and has received ${selfReplies.length} Commodus replies. Recent interaction beats: ${recent}`,
  );
}

function formatCastBeat(cast: MemoryCastRow): string {
  const speaker = cast.source === "self" ? "Commodus" : `FID ${cast.author_fid}`;
  return `${speaker}: "${truncateText(cast.text, 140)}"`;
}

function truncateText(text: string, maxLength: number): string {
  const clean = compactPlainText(text);
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
}

function compactPlainText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function latestTimestamp(casts: MemoryCastRow[]): string | null {
  let latest: string | null = null;
  for (const row of casts) {
    const t = row.created_at;
    if (!t) continue;
    if (!latest || t > latest) latest = t;
  }
  return latest;
}

function validFid(fid: number | null | undefined): fid is number {
  return typeof fid === "number" && Number.isFinite(fid) && fid > 0;
}

function assertOk(label: string, error: SupabaseError): void {
  if (!error) return;
  throw new Error(`${label}: ${error.message}`);
}
