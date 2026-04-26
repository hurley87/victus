import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import type { SocialCastEvent } from "@/lib/workflows/commodus-social";

const THREAD_MESSAGE_LIMIT = 10;
const RECENT_SELF_POST_LIMIT = 10;

const DOC_PATHS = {
  lore: "docs/commodus-agent/lore.md",
  voice: "docs/commodus-agent/voice.md",
  safety: "docs/commodus-agent/safety-rules.md",
} as const;

export interface SocialContextCast {
  hash: string;
  authorFid: number;
  text: string;
  source: string;
  createdAt: string | null;
}

export interface CommodusSocialContext {
  triggerCast: {
    hash: string;
    text: string;
    authorFid: number;
    authorUsername: string | null;
    threadHash: string;
  };
  threadMessages: SocialContextCast[];
  authorMemory: {
    summary: string;
    relationship: string;
  } | null;
  threadMemory: {
    summary: string;
    participants: Json;
  } | null;
  recentSelfPosts: SocialContextCast[];
  docs: {
    lore: string;
    voice: string;
    safety: string;
  };
}

export async function buildCommodusSocialContext(
  cast: SocialCastEvent,
): Promise<CommodusSocialContext> {
  const threadHash = cast.thread_hash ?? cast.hash;

  const [
    threadMessages,
    authorMemory,
    threadMemory,
    recentSelfPosts,
    docs,
  ] = await Promise.all([
    loadThreadMessages(threadHash),
    loadAuthorMemory(cast.author.fid),
    loadThreadMemory(threadHash),
    loadRecentSelfPosts(),
    loadSocialDocs(),
  ]);

  return {
    triggerCast: {
      hash: cast.hash,
      text: cast.text,
      authorFid: cast.author.fid,
      authorUsername: cast.author.username ?? null,
      threadHash,
    },
    threadMessages,
    authorMemory,
    threadMemory,
    recentSelfPosts,
    docs,
  };
}

async function loadThreadMessages(threadHash: string): Promise<SocialContextCast[]> {
  const { data, error } = await supabaseAdmin
    .from("commodus_casts")
    .select("hash,author_fid,text,source,created_at")
    .eq("thread_hash", threadHash)
    .order("created_at", { ascending: false })
    .limit(THREAD_MESSAGE_LIMIT);

  if (error) throw new Error(`commodus_casts context read failed: ${error.message}`);

  return (data ?? []).reverse().map((row) => ({
    hash: row.hash,
    authorFid: row.author_fid,
    text: row.text,
    source: row.source,
    createdAt: row.created_at ?? null,
  }));
}

async function loadAuthorMemory(
  fid: number,
): Promise<CommodusSocialContext["authorMemory"]> {
  const { data, error } = await supabaseAdmin
    .from("commodus_user_memory")
    .select("summary,relationship")
    .eq("fid", fid)
    .maybeSingle();

  if (error) throw new Error(`commodus_user_memory context read failed: ${error.message}`);
  if (!data) return null;

  return {
    summary: data.summary ?? "",
    relationship: data.relationship ?? "unknown",
  };
}

async function loadThreadMemory(
  threadHash: string,
): Promise<CommodusSocialContext["threadMemory"]> {
  const { data, error } = await supabaseAdmin
    .from("commodus_thread_memory")
    .select("summary,participants")
    .eq("thread_hash", threadHash)
    .maybeSingle();

  if (error) throw new Error(`commodus_thread_memory context read failed: ${error.message}`);
  if (!data) return null;

  return {
    summary: data.summary ?? "",
    participants: data.participants ?? [],
  };
}

async function loadRecentSelfPosts(): Promise<SocialContextCast[]> {
  const { data, error } = await supabaseAdmin
    .from("commodus_casts")
    .select("hash,author_fid,text,source,created_at")
    .eq("source", "self")
    .order("created_at", { ascending: false })
    .limit(RECENT_SELF_POST_LIMIT);

  if (error) throw new Error(`commodus_casts self context read failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    hash: row.hash,
    authorFid: row.author_fid,
    text: row.text,
    source: row.source,
    createdAt: row.created_at ?? null,
  }));
}

async function loadSocialDocs(): Promise<CommodusSocialContext["docs"]> {
  const [lore, voice, safety] = await Promise.all([
    readRuntimeDoc(DOC_PATHS.lore),
    readRuntimeDoc(DOC_PATHS.voice),
    readRuntimeDoc(DOC_PATHS.safety),
  ]);

  return { lore, voice, safety };
}

async function readRuntimeDoc(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

