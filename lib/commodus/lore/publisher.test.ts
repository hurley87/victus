import { describe, expect, it, vi } from "vitest";

import type { LorePublisherDeps } from "./publisher";
import {
  computeSeasonOneSchedule,
  createCommodusLorePublisher,
  loreIdempotencyKey,
} from "./publisher";
import { SEASON_1_LORE_POSTS } from "./season-1";

type TestRow = {
  id: string;
  season: number;
  day: number;
  text: string;
  status: string;
  scheduled_for: string | null;
  scheduled_at: string | null;
  cast_hash: string | null;
  idempotency_key: string;
  error: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
};

describe("publishNextCommodusLorePost", () => {
  it("does not rewrite queued rows that already match the season seed", async () => {
    const { db, operationCounts } = makeDb(
      SEASON_1_LORE_POSTS.map((post) => makeRow(post.day, "queued")),
    );
    const publishCast = vi.fn();
    const scheduledAt = Date.parse(computeSeasonOneSchedule(1).scheduledAt);
    const publisher = createCommodusLorePublisher({
      db,
      publishCast,
      now: () => new Date(scheduledAt - 60_000),
    });

    const result = await publisher.publishNextCommodusLorePost();

    expect(result).toEqual({
      posted: false,
      reason: "no_due_queued_lore_post",
    });
    expect(operationCounts.inserts).toBe(0);
    expect(operationCounts.updates).toBe(0);
  });

  it("does not post if no queued posts exist", async () => {
    const { db } = makeDb(
      SEASON_1_LORE_POSTS.map((post) => makeRow(post.day, "posted")),
    );
    const publishCast = vi.fn();
    const publisher = createCommodusLorePublisher({
      db,
      publishCast,
      now: () => new Date("2026-05-26T18:00:00.000Z"),
    });

    const result = await publisher.publishNextCommodusLorePost();

    expect(result).toEqual({
      posted: false,
      reason: "no_due_queued_lore_post",
    });
    expect(publishCast).not.toHaveBeenCalled();
  });

  it("does not publish a future scheduled post early", async () => {
    const { db } = makeDb();
    const publishCast = vi.fn();
    const scheduledAt = Date.parse(computeSeasonOneSchedule(1).scheduledAt);
    const publisher = createCommodusLorePublisher({
      db,
      publishCast,
      now: () => new Date(scheduledAt - 60_000),
    });

    const result = await publisher.publishNextCommodusLorePost();

    expect(result).toEqual({
      posted: false,
      reason: "no_due_queued_lore_post",
    });
    expect(publishCast).not.toHaveBeenCalled();
  });

  it("does not publish when today already has an attempted post", async () => {
    const { db } = makeDb([
      makeRow(1, "failed", { error: "Neynar was unavailable" }),
      ...SEASON_1_LORE_POSTS.slice(1).map((post) => makeRow(post.day, "queued")),
    ]);
    const publishCast = vi.fn();
    const publisher = createCommodusLorePublisher({
      db,
      publishCast,
      now: () => new Date("2026-04-26T23:30:00.000Z"),
    });

    const result = await publisher.publishNextCommodusLorePost();

    expect(result).toEqual({
      posted: false,
      day: 1,
      reason: "already_attempted:failed",
    });
    expect(publishCast).not.toHaveBeenCalled();
  });

  it("publishes only one queued post per invocation", async () => {
    const { db, rows } = makeDb();
    const publishCast = vi.fn().mockResolvedValue({
      hash: "0xlore",
      author_fid: 1,
      text: SEASON_1_LORE_POSTS[0]?.text ?? "",
    });
    const publisher = createCommodusLorePublisher({
      db,
      publishCast,
      now: () => new Date("2026-04-26T23:30:00.000Z"),
    });

    const result = await publisher.publishNextCommodusLorePost();

    expect(result).toEqual({ posted: true, day: 1, castHash: "0xlore" });
    expect(publishCast).toHaveBeenCalledTimes(1);
    expect(publishCast).toHaveBeenCalledWith(
      SEASON_1_LORE_POSTS[0]?.text,
      "commodus-lore:s1:d1",
    );
    expect(rows.filter((row) => row.status === "posted")).toHaveLength(1);
    expect(rows.find((row) => row.day === 2)?.status).toBe("queued");
  });

  it("skips overlong claimed text without publishing", async () => {
    const { db, rows } = makeDb(
      [
        makeRow(1, "queued", { text: "x".repeat(321) }),
        ...SEASON_1_LORE_POSTS.slice(1).map((post) => makeRow(post.day, "queued")),
      ],
      { preserveExistingText: true },
    );
    const publishCast = vi.fn();
    const publisher = createCommodusLorePublisher({
      db,
      publishCast,
      now: () => new Date("2026-04-26T23:30:00.000Z"),
    });

    const result = await publisher.publishNextCommodusLorePost();

    expect(result).toEqual({
      posted: false,
      day: 1,
      reason: "post_too_long",
    });
    expect(publishCast).not.toHaveBeenCalled();
    expect(rows.find((row) => row.day === 1)?.status).toBe("skipped");
  });
});

function makeRow(
  day: number,
  status: string,
  overrides: Partial<TestRow> = {},
): TestRow {
  const post = SEASON_1_LORE_POSTS.find((entry) => entry.day === day);
  if (!post) throw new Error(`Missing lore post for day ${day}`);
  const schedule = computeSeasonOneSchedule(day);

  return {
    id: `row-${day}`,
    season: 1,
    day,
    text: post.text,
    status,
    scheduled_for: schedule.scheduledFor,
    scheduled_at: schedule.scheduledAt,
    cast_hash: status === "posted" ? `0xposted${day}` : null,
    idempotency_key: loreIdempotencyKey(post),
    error: null,
    posted_at: status === "posted" ? schedule.scheduledAt : null,
    created_at: "2026-04-24T00:00:00.000Z",
    updated_at: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

function makeDb(
  initialRows: TestRow[] = [],
  options: { preserveExistingText?: boolean } = {},
) {
  const rows = [...initialRows];
  const operationCounts = {
    inserts: 0,
    updates: 0,
  };
  const db = {
    from: () => new FakeQuery(rows, options, operationCounts),
  } as unknown as LorePublisherDeps["db"];

  return { db, rows, operationCounts };
}

class FakeQuery {
  private operation: "select" | "insert" | "update" = "select";
  private payload: unknown = null;
  private readonly filters: Array<(row: TestRow) => boolean> = [];
  private readonly sorters: Array<{
    column: keyof TestRow;
    ascending: boolean;
  }> = [];
  private limitCount: number | null = null;

  constructor(
    private readonly rows: TestRow[],
    private readonly options: { preserveExistingText?: boolean },
    private readonly operationCounts: { inserts: number; updates: number },
  ) {}

  select() {
    return this;
  }

  insert(payload: unknown) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  eq(column: keyof TestRow, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: keyof TestRow, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  in(column: keyof TestRow, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  lte(column: keyof TestRow, value: unknown) {
    this.filters.push((row) => String(row[column]) <= String(value));
    return this;
  }

  order(column: keyof TestRow, options?: { ascending?: boolean }) {
    this.sorters.push({
      column,
      ascending: options?.ascending ?? true,
    });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  maybeSingle() {
    const result = this.execute();
    if (result.error) return Promise.resolve(result);
    return Promise.resolve({
      data: result.data[0] ?? null,
      error: null,
    });
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult {
    if (this.operation === "insert") {
      this.operationCounts.inserts += 1;
      const payload = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const item of payload) {
        const row = item as Partial<TestRow>;
        this.rows.push({
          id: row.id ?? `row-${String(row.day)}`,
          season: row.season ?? 1,
          day: row.day ?? 0,
          text: row.text ?? "",
          status: row.status ?? "queued",
          scheduled_for: row.scheduled_for ?? null,
          scheduled_at: row.scheduled_at ?? null,
          cast_hash: row.cast_hash ?? null,
          idempotency_key: row.idempotency_key ?? `test:${String(row.day)}`,
          error: row.error ?? null,
          posted_at: row.posted_at ?? null,
          created_at: row.created_at ?? "2026-04-24T00:00:00.000Z",
          updated_at: row.updated_at ?? "2026-04-24T00:00:00.000Z",
        });
      }
      return { data: [], error: null };
    }

    let matches = this.rows.filter((row) =>
      this.filters.every((filter) => filter(row)),
    );

    if (this.operation === "update") {
      this.operationCounts.updates += 1;
      const patch = { ...(this.payload as Partial<TestRow>) };
      if (this.options.preserveExistingText) {
        delete patch.text;
      }
      for (const row of matches) {
        Object.assign(row, patch);
      }
    }

    matches = [...matches].sort((a, b) => {
      for (const sorter of this.sorters) {
        const left = a[sorter.column];
        const right = b[sorter.column];
        if (left === right) continue;
        const direction = sorter.ascending ? 1 : -1;
        return String(left) > String(right) ? direction : -direction;
      }
      return 0;
    });

    if (this.limitCount != null) {
      matches = matches.slice(0, this.limitCount);
    }

    return { data: matches, error: null };
  }
}

type QueryResult = {
  data: TestRow[];
  error: null;
};
