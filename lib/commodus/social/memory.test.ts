import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const start = vi.hoisted(() => vi.fn().mockResolvedValue({ runId: "memory-run-1" }));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: { from },
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
  runCommodusSocialMemoryRefresh,
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
      limitCount: undefined as number | undefined,
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
      limit(count: number) {
        this.limitCount = count;
        return this;
      },
      maybeSingle() {
        if (table === "commodus_casts") {
          const row = rowsFor(table, this)[0] ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        if (table === "commodus_user_memory" && existingRelationship) {
          return Promise.resolve({
            data: { relationship: existingRelationship },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (value: { data: CastRow[]; error: null }) => void) {
        return Promise.resolve({
          data: rowsFor(table, this),
          error: null,
        }).then(resolve);
      },
      upsert(row: Record<string, unknown>, options?: unknown) {
        upserts.push({ table, row, options });
        return Promise.resolve({ error: null });
      },
    };
    return query;
  });
}

type QueryState = {
  filters: Array<{ column: string; value: unknown }>;
  orFilter: string;
  limitCount?: number;
};

function rowsFor(table: string, query: QueryState): CastRow[] {
  if (table !== "commodus_casts") return [];

  let rows = casts.filter((row) =>
    query.filters.every((filter) => row[filter.column as keyof CastRow] === filter.value),
  );

  const fidMatch = query.orFilter.match(/author_fid\.eq\.(\d+),parent_author_fid\.eq\.(\d+)/);
  if (fidMatch) {
    const fid = Number(fidMatch[1]);
    rows = rows.filter((row) => row.author_fid === fid || row.parent_author_fid === fid);
  }

  rows.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  if (query.limitCount === 1) rows.reverse();
  return typeof query.limitCount === "number" ? rows.slice(0, query.limitCount) : rows;
}

describe("commodus social memory", () => {
  beforeEach(() => {
    casts.length = 0;
    existingRelationship = null;
    upserts.length = 0;
    from.mockReset();
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

  it("starts a background memory workflow with a debounce delay", async () => {
    const result = await scheduleCommodusSocialMemoryRefresh({
      threadHash: "0xthread",
      fid: 42,
      lastCastHash: "0xself-2",
    });

    expect(result).toEqual({ runId: "memory-run-1" });
    expect(start).toHaveBeenCalledWith(expect.any(Function), [
      {
        threadHash: "0xthread",
        fid: 42,
        lastCastHash: "0xself-2",
        delayMs: 60000,
      },
    ]);
  });

  it("skips stale scheduled refreshes when a newer self-cast exists", async () => {
    casts.push(
      cast({ hash: "0xinbound-1", author_fid: 42 }),
      cast({
        hash: "0xself-1",
        author_fid: 999,
        parent_author_fid: 42,
        source: "self",
        text: "first reply",
        created_at: "2026-04-26T00:01:00.000Z",
      }),
      cast({
        hash: "0xself-2",
        author_fid: 999,
        parent_author_fid: 42,
        source: "self",
        text: "newer reply",
        created_at: "2026-04-26T00:02:00.000Z",
      }),
    );

    await expect(
      runCommodusSocialMemoryRefresh({
        threadHash: "0xthread",
        fid: 42,
        lastCastHash: "0xself-1",
        delayMs: 1,
      }),
    ).resolves.toEqual({
      thread: {
        status: "skipped",
        key: "0xthread",
        reason: "debounced_by_newer_cast",
      },
      user: {
        status: "skipped",
        key: "42",
        reason: "debounced_by_newer_cast",
      },
    });
    expect(upserts).toEqual([]);
  });
});
