import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const redis = vi.hoisted(() => ({
  set: vi.fn().mockResolvedValue("OK"),
  get: vi.fn(),
}));
const start = vi.hoisted(() => vi.fn().mockResolvedValue({ runId: "memory-run-1" }));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: { from },
}));

vi.mock("@/lib/redis", () => ({
  redis,
}));

vi.mock("workflow/api", () => ({
  start,
}));

vi.mock("workflow", () => ({
  sleep: vi.fn(),
}));

import {
  refreshThreadMemory,
  refreshUserMemory,
  scheduleCommodusSocialMemoryRefresh,
} from "./memory";

type CastRow = {
  hash: string;
  thread_hash: string;
  parent_hash: string | null;
  parent_author_fid: number | null;
  author_fid: number;
  text: string;
  source: string;
  created_at: string | null;
};

const casts: CastRow[] = [];
let existingRelationship: string | null = null;
const upserts: Array<{ table: string; row: Record<string, unknown>; options?: unknown }> = [];

function cast(overrides: Partial<CastRow>): CastRow {
  return {
    hash: "0xcast",
    thread_hash: "0xthread",
    parent_hash: null,
    parent_author_fid: null,
    author_fid: 42,
    text: "hello",
    source: "webhook",
    created_at: "2026-04-26T00:00:00.000Z",
    ...overrides,
  };
}

function installSupabaseMock() {
  from.mockImplementation((table: string) => {
    const query = {
      filters: [] as Array<{ column: string; value: unknown }>,
      orFilter: "",
      select() {
        return this;
      },
      eq(column: string, value: unknown) {
        this.filters.push({ column, value });
        return this;
      },
      or(filter: string) {
        this.orFilter = filter;
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return Promise.resolve({ data: rowsFor(table, this), error: null });
      },
      maybeSingle() {
        if (table === "commodus_user_memory" && existingRelationship) {
          return Promise.resolve({
            data: { relationship: existingRelationship },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      upsert(row: Record<string, unknown>, options?: unknown) {
        upserts.push({ table, row, options });
        return Promise.resolve({ error: null });
      },
    };
    return query;
  });
}

function rowsFor(table: string, query: { filters: Array<{ column: string; value: unknown }>; orFilter: string }) {
  if (table !== "commodus_casts") return [];

  const sourceFilter = query.filters.find((filter) => filter.column === "source");
  if (sourceFilter) {
    return casts.filter((row) => row.source === sourceFilter.value);
  }

  const threadFilter = query.filters.find((filter) => filter.column === "thread_hash");
  if (threadFilter) {
    return casts.filter((row) => row.thread_hash === threadFilter.value);
  }

  const fidMatch = query.orFilter.match(/author_fid\.eq\.(\d+),parent_author_fid\.eq\.(\d+)/);
  if (fidMatch) {
    const fid = Number(fidMatch[1]);
    return casts.filter((row) => row.author_fid === fid || row.parent_author_fid === fid);
  }

  return casts;
}

describe("commodus social memory", () => {
  beforeEach(() => {
    casts.length = 0;
    existingRelationship = null;
    upserts.length = 0;
    from.mockReset();
    redis.set.mockClear();
    redis.get.mockReset();
    start.mockClear().mockResolvedValue({ runId: "memory-run-1" });
    installSupabaseMock();
  });

  it("updates thread memory only after Commodus has posted twice in a thread", async () => {
    casts.push(
      cast({ hash: "0xinbound-1", author_fid: 42, text: "first poke" }),
      cast({
        hash: "0xself-1",
        author_fid: 999,
        parent_author_fid: 42,
        source: "self",
        text: "first reply",
      }),
    );

    await expect(refreshThreadMemory("0xthread")).resolves.toEqual({
      status: "skipped",
      key: "0xthread",
      reason: "self_posts_below_threshold",
    });
    expect(upserts).toEqual([]);

    casts.push(
      cast({
        hash: "0xself-2",
        author_fid: 999,
        parent_author_fid: 42,
        source: "self",
        text: "second reply",
        created_at: "2026-04-26T00:02:00.000Z",
      }),
    );

    const result = await refreshThreadMemory("0xthread");

    expect(result).toMatchObject({ status: "updated", key: "0xthread" });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      table: "commodus_thread_memory",
      row: {
        thread_hash: "0xthread",
        last_cast_hash: "0xself-2",
        participants: [42, 999],
      },
      options: { onConflict: "thread_hash" },
    });
    expect(String(upserts[0].row.summary)).toContain("Commodus has posted 2 times");
  });

  it("updates user memory after Commodus has replied to the FID twice", async () => {
    existingRelationship = "rival";
    casts.push(
      cast({ hash: "0xinbound-1", author_fid: 42, text: "you are late" }),
      cast({
        hash: "0xself-1",
        author_fid: 999,
        parent_author_fid: 42,
        source: "self",
        text: "I arrive when the chart deserves me.",
      }),
      cast({
        hash: "0xself-2",
        author_fid: 999,
        parent_author_fid: 42,
        source: "self",
        text: "You came back anyway.",
        created_at: "2026-04-26T00:03:00.000Z",
      }),
    );

    const result = await refreshUserMemory(42);

    expect(result).toMatchObject({ status: "updated", key: "42" });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      table: "commodus_user_memory",
      row: {
        fid: 42,
        relationship: "rival",
        last_interaction_at: "2026-04-26T00:03:00.000Z",
      },
      options: { onConflict: "fid" },
    });
    expect(String(upserts[0].row.summary)).toContain("received 2 Commodus replies");
  });

  it("stores debounce tokens and starts a background memory workflow", async () => {
    const result = await scheduleCommodusSocialMemoryRefresh({
      threadHash: "0xthread",
      fid: 42,
      lastCastHash: "0xself-2",
    });

    expect(result).toEqual({ runId: "memory-run-1" });
    expect(redis.set).toHaveBeenCalledWith(
      "commodus:memory:thread:0xthread",
      "0xself-2",
      { ex: 600 },
    );
    expect(redis.set).toHaveBeenCalledWith("commodus:memory:user:42", "0xself-2", {
      ex: 600,
    });
    expect(start).toHaveBeenCalledWith(expect.any(Function), [
      {
        threadHash: "0xthread",
        fid: 42,
        lastCastHash: "0xself-2",
        delayMs: 60000,
      },
    ]);
  });
});
