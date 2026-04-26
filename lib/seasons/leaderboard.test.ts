import { describe, expect, it, vi } from "vitest";

import {
  buildSeasonLeaderboard,
  getCachedSeasonTokenPrices,
} from "./leaderboard";
import type { Season, SeasonToken } from "./service";

const season: Season = {
  id: "season-1",
  name: "Week 1",
  status: "active",
  starts_at: "2026-04-26T00:00:00.000Z",
  ends_at: "2026-05-03T00:00:00.000Z",
  starting_balance_usdc: 10,
  max_trades: 5,
  min_trade_size_usdc: 2,
  settled_at: null,
  created_at: "2026-04-26T00:00:00.000Z",
};

const token: SeasonToken = {
  id: "token-1",
  season_id: "season-1",
  token_symbol: "AERO",
  token_address: "0x00000000000000000000000000000000000000a1",
  chain_id: 8453,
  decimals: 18,
  is_active: true,
  closing_price_usdc: null,
  created_at: "2026-04-26T00:00:00.000Z",
};

const accounts = [
  { user_id: "user-alpha", fid: 101, username: "alpha" },
  { user_id: "user-bravo", fid: 102, username: "bravo" },
  { user_id: "user-early", fid: 103, username: "early" },
  { user_id: "user-late", fid: 104, username: "late" },
  { user_id: "user-unqualified", fid: 105, username: "newbie" },
  { user_id: "user-disqualified", fid: 106, username: "dq" },
  { user_id: "user-commodus", fid: 999, username: "commodus" },
];

describe("buildSeasonLeaderboard", () => {
  it("ranks eligible entries by portfolio value, then trades used, then earlier entry", () => {
    const result = buildSeasonLeaderboard({
      season,
      commodusFid: 999,
      accounts,
      prices: new Map([
        ["0x00000000000000000000000000000000000000a1", 2],
      ]),
      entries: [
        entry("entry-alpha", "user-alpha", {
          cash: 6,
          trades: 3,
          createdAt: "2026-04-26T10:00:00.000Z",
        }),
        entry("entry-bravo", "user-bravo", {
          cash: 7,
          trades: 1,
          createdAt: "2026-04-26T11:00:00.000Z",
        }),
        entry("entry-early", "user-early", {
          cash: 5,
          trades: 2,
          createdAt: "2026-04-26T09:00:00.000Z",
        }),
        entry("entry-late", "user-late", {
          cash: 5,
          trades: 2,
          createdAt: "2026-04-26T12:00:00.000Z",
        }),
      ],
      positions: [
        position("entry-alpha", 2), // 10 USDC portfolio
        position("entry-bravo", 1.5), // 10 USDC portfolio, fewer trades wins
        position("entry-early", 2), // 9 USDC, earlier wins tie
        position("entry-late", 2), // 9 USDC
      ],
    });

    expect(result.entries.map((row) => row.user_id)).toEqual([
      "user-bravo",
      "user-alpha",
      "user-early",
      "user-late",
    ]);
    expect(result.entries.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
    expect(result.entries[0]?.portfolio_value_usdc).toBe(10);
    expect(result.entries[0]?.performance_return).toBe(0);
  });

  it("keeps unqualified and disqualified players out of ranked rewards", () => {
    const result = buildSeasonLeaderboard({
      season,
      commodusFid: 999,
      accounts,
      prices: new Map([
        ["0x00000000000000000000000000000000000000a1", 5],
      ]),
      entries: [
        entry("entry-alpha", "user-alpha", { cash: 8, trades: 1 }),
        entry("entry-unqualified", "user-unqualified", {
          cash: 20,
          trades: 0,
          hasQualifyingTrade: false,
        }),
        entry("entry-disqualified", "user-disqualified", {
          cash: 30,
          trades: 1,
          status: "disqualified",
        }),
      ],
      positions: [
        position("entry-unqualified", 5),
        position("entry-disqualified", 5),
      ],
    });

    expect(result.entries.map((row) => row.user_id)).toEqual(["user-alpha"]);
    expect(result.ineligible.map((row) => row.user_id)).toEqual([
      "user-disqualified",
      "user-unqualified",
    ]);
    expect(result.ineligible.every((row) => row.rank === null)).toBe(true);
  });

  it("marks the Commodus row from COMMODUS_FID-equivalent input", () => {
    const result = buildSeasonLeaderboard({
      season,
      commodusFid: 999,
      accounts,
      prices: new Map(),
      entries: [entry("entry-commodus", "user-commodus", { cash: 10 })],
      positions: [],
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      user_id: "user-commodus",
      fid: 999,
      is_commodus: true,
    });
  });
});

describe("getCachedSeasonTokenPrices", () => {
  it("uses the cached price on a second request within the TTL", async () => {
    const store = new Map<string, string>();
    const cache = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    };
    const quotePrice = vi.fn(async () => 1.23);

    const first = await getCachedSeasonTokenPrices({
      season,
      tokens: [token],
      taker: "0x0000000000000000000000000000000000000001",
      cache,
      quotePrice,
    });
    const second = await getCachedSeasonTokenPrices({
      season,
      tokens: [token],
      taker: "0x0000000000000000000000000000000000000001",
      cache,
      quotePrice,
    });

    expect(first.get(token.token_address.toLowerCase())).toBe(1.23);
    expect(second.get(token.token_address.toLowerCase())).toBe(1.23);
    expect(quotePrice).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      `season:${season.id}:price:${token.token_address.toLowerCase()}`,
      "1.23",
      { ex: 60 },
    );
  });
});

function entry(
  id: string,
  userId: string,
  overrides: {
    cash?: number;
    trades?: number;
    createdAt?: string;
    hasQualifyingTrade?: boolean;
    status?: string;
  } = {},
) {
  return {
    id,
    user_id: userId,
    wallet_id: `wallet-${userId}`,
    cash_remaining_usdc: overrides.cash ?? 10,
    starting_balance_usdc: 10,
    trades_used: overrides.trades ?? 1,
    has_qualifying_trade: overrides.hasQualifyingTrade ?? true,
    status: overrides.status ?? "active",
    created_at: overrides.createdAt ?? "2026-04-26T10:00:00.000Z",
  };
}

function position(entryId: string, amount: number) {
  return {
    season_entry_id: entryId,
    token_symbol: "AERO",
    token_address: token.token_address,
    token_amount: amount,
  };
}
