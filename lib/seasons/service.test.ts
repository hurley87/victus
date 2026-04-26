import { describe, expect, it, vi } from "vitest";

import {
  getOrCreateSeasonEntry,
  hasSufficientEntryFunding,
  type Season,
  type SeasonEntry,
} from "./service";

function buildSeason(overrides: Partial<Season> = {}): Season {
  return {
    id: "season-1",
    name: "Week 18 · 2026",
    status: "active",
    starts_at: "2026-04-20T00:00:00Z",
    ends_at: "2026-04-27T00:00:00Z",
    starting_balance_usdc: 10,
    max_trades: 5,
    min_trade_size_usdc: 2,
    settled_at: null,
    created_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

function buildEntry(overrides: Partial<SeasonEntry> = {}): SeasonEntry {
  return {
    id: "entry-1",
    season_id: "season-1",
    user_id: "user-1",
    wallet_id: "wallet-1",
    starting_balance_usdc: 10,
    cash_remaining_usdc: 10,
    trades_used: 0,
    max_trades: 5,
    has_qualifying_trade: false,
    status: "active",
    settled_portfolio_value_usdc: null,
    settled_return_pct: null,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

type ReadCall = { table: "season_entries"; result: SeasonEntry | null };
type InsertCall = {
  table: "season_entries";
  result: { data: SeasonEntry | null; error: { code?: string; message: string } | null };
};

function makeClient(steps: Array<ReadCall | InsertCall>) {
  let i = 0;
  const from = vi.fn(() => {
    const step = steps[i++];
    if (!step) throw new Error("unexpected supabase call");
    if ("result" in step && step.result && "data" in step.result) {
      const insert = step as InsertCall;
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(insert.result),
      };
    }
    const read = step as ReadCall;
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: read.result, error: null }),
    };
  });
  return { from } as unknown as Parameters<typeof getOrCreateSeasonEntry>[1];
}

describe("hasSufficientEntryFunding", () => {
  it("rejects wallets below the season starting balance", () => {
    expect(hasSufficientEntryFunding(9.99, 10)).toBe(false);
    expect(hasSufficientEntryFunding(0, 10)).toBe(false);
  });

  it("accepts wallets at or above the floor (including float epsilon)", () => {
    expect(hasSufficientEntryFunding(10, 10)).toBe(true);
    expect(hasSufficientEntryFunding(12, 10)).toBe(true);
    // Floating-point noise just under 10 should still pass.
    expect(hasSufficientEntryFunding(10 - 1e-12, 10)).toBe(true);
  });
});

describe("getOrCreateSeasonEntry", () => {
  it("returns the existing entry without inserting (idempotent)", async () => {
    const existing = buildEntry();
    const client = makeClient([
      { table: "season_entries", result: existing },
    ]);

    const out = await getOrCreateSeasonEntry(
      { season: buildSeason(), userId: "user-1", walletId: "wallet-1" },
      client,
    );

    expect(out).toEqual({ entry: existing, created: false });
  });

  it("inserts a new entry seeded from the season's starting balance", async () => {
    const inserted = buildEntry();
    const client = makeClient([
      { table: "season_entries", result: null },
      {
        table: "season_entries",
        result: { data: inserted, error: null },
      },
    ]);

    const out = await getOrCreateSeasonEntry(
      { season: buildSeason(), userId: "user-1", walletId: "wallet-1" },
      client,
    );

    expect(out.created).toBe(true);
    expect(out.entry).toEqual(inserted);
  });

  it("recovers from a unique-violation race by re-reading the winner's row", async () => {
    const winner = buildEntry({ id: "entry-winner" });
    const client = makeClient([
      { table: "season_entries", result: null },
      {
        table: "season_entries",
        result: {
          data: null,
          error: { code: "23505", message: "duplicate key value" },
        },
      },
      { table: "season_entries", result: winner },
    ]);

    const out = await getOrCreateSeasonEntry(
      { season: buildSeason(), userId: "user-1", walletId: "wallet-1" },
      client,
    );

    expect(out).toEqual({ entry: winner, created: false });
  });
});
