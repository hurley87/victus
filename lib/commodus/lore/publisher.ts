import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isUniqueViolation } from "@/lib/execution/reserve";
import type { PublishedCast } from "@/lib/neynar";
import type { Database } from "@/lib/supabase/types";

import {
  MAX_LORE_POST_CHARS,
  SEASON_1_LORE_POSTS,
  type SeasonLorePost,
} from "./season-1";

const SEASON_1 = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const JITTER_WINDOW_START_HOUR_UTC = 13;
const JITTER_WINDOW_MINUTES = 10 * 60;

const CLAIMED_LORE_POST_SELECT = "id, day, text, idempotency_key";

const ATTEMPTED_STATUSES = ["posting", "posted", "failed", "skipped"] as const;

export const SEASON_1_START_DATE_UTC = "2026-04-26";

type LorePostRow = Database["public"]["Tables"]["commodus_lore_posts"]["Row"];
type LorePostInsert =
  Database["public"]["Tables"]["commodus_lore_posts"]["Insert"];
type LorePostUpdate =
  Database["public"]["Tables"]["commodus_lore_posts"]["Update"];
type SeededLorePostRow = Pick<
  LorePostRow,
  "id" | "day" | "status" | "text" | "scheduled_for" | "scheduled_at" | "idempotency_key"
>;
type ClaimedLorePostRow = Pick<
  LorePostRow,
  "id" | "day" | "text" | "idempotency_key"
>;
type LoreDatabase = Pick<SupabaseClient<Database>, "from">;
type PublishCast = (
  text: string,
  idemKey: string,
  embeds?: { url: string }[],
) => Promise<PublishedCast>;

export type PublishLoreResult = {
  posted: boolean;
  day?: number;
  castHash?: string;
  reason?: string;
};

export type LorePublisherDeps = {
  db: LoreDatabase;
  publishCast: PublishCast;
  now?: () => Date;
};

export type SeasonLoreSchedule = {
  scheduledFor: string;
  scheduledAt: string;
};

export function loreIdempotencyKey(post: Pick<SeasonLorePost, "season" | "day">): string {
  return `commodus-lore:s${post.season}:d${post.day}`;
}

export function computeSeasonOneSchedule(day: number): SeasonLoreSchedule {
  if (!Number.isInteger(day) || day < 1 || day > 30) {
    throw new Error(`Season 1 lore day must be 1 through 30, got ${day}`);
  }

  const startMs = Date.parse(`${SEASON_1_START_DATE_UTC}T00:00:00.000Z`);
  const scheduledForDate = new Date(startMs + (day - 1) * DAY_MS);
  const scheduledFor = scheduledForDate.toISOString().slice(0, 10);
  const idempotencyKey = loreIdempotencyKey({ season: SEASON_1, day });
  const minuteOffset = stableHash(idempotencyKey) % JITTER_WINDOW_MINUTES;
  const scheduledAt = new Date(
    Date.parse(`${scheduledFor}T00:00:00.000Z`) +
      JITTER_WINDOW_START_HOUR_UTC * 60 * 60 * 1000 +
      minuteOffset * 60 * 1000,
  );

  return {
    scheduledFor,
    scheduledAt: scheduledAt.toISOString(),
  };
}

export function createCommodusLorePublisher(deps: LorePublisherDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    ensureSeasonOneLoreSeeded: () => ensureSeasonOneLoreSeededWithDeps(deps.db),
    publishNextCommodusLorePost: () =>
      publishNextCommodusLorePostWithDeps({
        db: deps.db,
        publishCast: deps.publishCast,
        now,
      }),
  };
}

export async function ensureSeasonOneLoreSeeded(): Promise<void> {
  const { db } = await loadDefaultDeps();
  await ensureSeasonOneLoreSeededWithDeps(db);
}

export async function publishNextCommodusLorePost(): Promise<PublishLoreResult> {
  const deps = await loadDefaultDeps();
  return await publishNextCommodusLorePostWithDeps({
    ...deps,
    now: () => new Date(),
  });
}

async function ensureSeasonOneLoreSeededWithDeps(db: LoreDatabase): Promise<void> {
  const { data, error } = await db
    .from("commodus_lore_posts")
    .select("id, day, status, text, scheduled_for, scheduled_at, idempotency_key")
    .eq("season", SEASON_1);

  if (error) {
    throw new Error(`commodus_lore_posts seed lookup failed: ${error.message}`);
  }

  const existingByDay = new Map(
    ((data ?? []) as SeededLorePostRow[]).map((row) => [
      row.day,
      row,
    ]),
  );
  const inserts: LorePostInsert[] = [];
  const updates: Array<{ id: string; patch: LorePostUpdate }> = [];

  for (const post of SEASON_1_LORE_POSTS) {
    const seed = buildSeedRow(post);
    const existing = existingByDay.get(post.day);

    if (!existing) {
      inserts.push(seed);
      continue;
    }

    if (existing.status !== "posted" && needsSeedUpdate(existing, seed)) {
      updates.push({
        id: existing.id,
        patch: {
          text: seed.text,
          scheduled_for: seed.scheduled_for,
          scheduled_at: seed.scheduled_at,
          idempotency_key: seed.idempotency_key,
        },
      });
    }
  }

  if (inserts.length > 0) {
    const { error: insertError } = await db
      .from("commodus_lore_posts")
      .insert(inserts);

    if (insertError) {
      throw new Error(`commodus_lore_posts seed insert failed: ${insertError.message}`);
    }
  }

  for (const update of updates) {
    const { error: updateError } = await db
      .from("commodus_lore_posts")
      .update(update.patch)
      .eq("id", update.id)
      .neq("status", "posted");

    if (updateError) {
      throw new Error(`commodus_lore_posts seed update failed: ${updateError.message}`);
    }
  }
}

async function publishNextCommodusLorePostWithDeps(
  deps: Required<LorePublisherDeps>,
): Promise<PublishLoreResult> {
  await ensureSeasonOneLoreSeededWithDeps(deps.db);

  const now = deps.now();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);

  const attempted = await findAttemptedForDate(deps.db, today);
  if (attempted) {
    return {
      posted: false,
      day: attempted.day,
      reason: `already_attempted:${attempted.status}`,
    };
  }

  const candidate = await findDueQueuedPost(deps.db, today, nowIso);
  if (!candidate) {
    return { posted: false, reason: "no_due_queued_lore_post" };
  }

  const claimed = await claimQueuedPost(deps.db, candidate.id);
  if (!claimed) {
    return { posted: false, day: candidate.day, reason: "claim_lost" };
  }

  if (claimed.text.length > MAX_LORE_POST_CHARS) {
    await markPostSkipped(
      deps.db,
      claimed.id,
      `Lore post exceeds ${MAX_LORE_POST_CHARS} chars`,
    );
    return {
      posted: false,
      day: claimed.day,
      reason: "post_too_long",
    };
  }

  try {
    const published = await deps.publishCast(claimed.text, claimed.idempotency_key);
    await markPostPosted(deps.db, claimed.id, published.hash, deps.now().toISOString());

    return {
      posted: true,
      day: claimed.day,
      castHash: published.hash,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown publish error";
    await markPostFailed(deps.db, claimed.id, message);
    return {
      posted: false,
      day: claimed.day,
      reason: message,
    };
  }
}

function buildSeedRow(post: SeasonLorePost): LorePostInsert {
  const schedule = computeSeasonOneSchedule(post.day);
  return {
    season: post.season,
    day: post.day,
    text: post.text,
    status: "queued",
    scheduled_for: schedule.scheduledFor,
    scheduled_at: schedule.scheduledAt,
    idempotency_key: loreIdempotencyKey(post),
  };
}

async function findAttemptedForDate(
  db: LoreDatabase,
  scheduledFor: string,
): Promise<Pick<LorePostRow, "day" | "status"> | null> {
  const { data, error } = await db
    .from("commodus_lore_posts")
    .select("day, status")
    .eq("season", SEASON_1)
    .eq("scheduled_for", scheduledFor)
    .in("status", [...ATTEMPTED_STATUSES])
    .maybeSingle();

  if (error) {
    throw new Error(`commodus_lore_posts attempt lookup failed: ${error.message}`);
  }

  return data ?? null;
}

async function findDueQueuedPost(
  db: LoreDatabase,
  scheduledFor: string,
  nowIso: string,
): Promise<Pick<LorePostRow, "id" | "day"> | null> {
  const { data, error } = await db
    .from("commodus_lore_posts")
    .select("id, day")
    .eq("season", SEASON_1)
    .eq("status", "queued")
    .eq("scheduled_for", scheduledFor)
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .order("day", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`commodus_lore_posts due lookup failed: ${error.message}`);
  }

  return data ?? null;
}

async function claimQueuedPost(
  db: LoreDatabase,
  id: string,
): Promise<ClaimedLorePostRow | null> {
  const { data, error } = await db
    .from("commodus_lore_posts")
    .update({ status: "posting", error: null })
    .eq("id", id)
    .eq("status", "queued")
    .select(CLAIMED_LORE_POST_SELECT)
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) return null;
    throw new Error(`commodus_lore_posts claim failed: ${error.message}`);
  }

  return (data as ClaimedLorePostRow | null) ?? null;
}

async function markPostPosted(
  db: LoreDatabase,
  id: string,
  castHash: string,
  postedAt: string,
): Promise<void> {
  const { error } = await db
    .from("commodus_lore_posts")
    .update({
      status: "posted",
      cast_hash: castHash,
      posted_at: postedAt,
      error: null,
    })
    .eq("id", id);

  if (error) {
    throw new Error(`commodus_lore_posts posted update failed: ${error.message}`);
  }
}

async function markPostFailed(
  db: LoreDatabase,
  id: string,
  message: string,
): Promise<void> {
  const { error } = await db
    .from("commodus_lore_posts")
    .update({ status: "failed", error: message.slice(0, 1000) })
    .eq("id", id);

  if (error) {
    throw new Error(`commodus_lore_posts failure update failed: ${error.message}`);
  }
}

async function markPostSkipped(
  db: LoreDatabase,
  id: string,
  message: string,
): Promise<void> {
  const { error } = await db
    .from("commodus_lore_posts")
    .update({ status: "skipped", error: message })
    .eq("id", id);

  if (error) {
    throw new Error(`commodus_lore_posts skipped update failed: ${error.message}`);
  }
}

async function loadDefaultDeps(): Promise<{
  db: LoreDatabase;
  publishCast: PublishCast;
}> {
  const [{ supabaseAdmin }, { publishCast }] = await Promise.all([
    import("@/lib/supabase/server"),
    import("@/lib/neynar"),
  ]);

  return {
    db: supabaseAdmin,
    publishCast,
  };
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function needsSeedUpdate(
  existing: SeededLorePostRow,
  seed: LorePostInsert,
): boolean {
  return (
    existing.text !== seed.text ||
    existing.scheduled_for !== seed.scheduled_for ||
    existing.scheduled_at !== seed.scheduled_at ||
    existing.idempotency_key !== seed.idempotency_key
  );
}
