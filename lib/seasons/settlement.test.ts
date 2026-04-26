import { describe, expect, it, vi } from "vitest";

import {
  computeSettledPortfolioValue,
  settleSeason,
  type SettlementStore,
} from "./settlement";
import type { Season, SeasonToken } from "./service";

const endedSeason: Season = {
  id: "season-1",
  name: "Week 1",
  status: "active",
  starts_at: "2026-04-19T00:00:00.000Z",
  ends_at: "2026-04-26T00:00:00.000Z",
  starting_balance_usdc: 10,
  max_trades: 5,
  min_trade_size_usdc: 2,
  settled_at: null,
  created_at: "2026-04-19T00:00:00.000Z",
};

const aero: SeasonToken = {
  id: "token-aero",
  season_id: "season-1",
  token_symbol: "AERO",
  token_address: "0x00000000000000000000000000000000000000a1",
  chain_id: 8453,
  decimals: 18,
  is_active: true,
  closing_price_usdc: null,
  created_at: "2026-04-19T00:00:00.000Z",
};

describe("settleSeason", () => {
  it("is a no-op before season end", async () => {
    const store = makeStore({ season: endedSeason });
    const quotePrice = vi.fn(async () => 2);

    const result = await settleSeason({
      now: new Date("2026-04-25T23:59:59.000Z"),
      store,
      quotePrice,
    });

    expect(result).toMatchObject({ status: "too_early", settled_entries: 0 });
    expect(quotePrice).not.toHaveBeenCalled();
    expect(store.savedPrices).toEqual([]);
    expect(store.updatedEntries).toEqual([]);
  });

  it("settles closing prices and active entries after season end", async () => {
    const store = makeStore({
      season: endedSeason,
      tokens: [aero],
      entries: [
        entry("entry-winner", { cash: 5, starting: 10 }),
        entry("entry-cash", { cash: 10, starting: 10 }),
      ],
      positions: [
        {
          season_entry_id: "entry-winner",
          token_address: aero.token_address,
          token_amount: 4,
        },
      ],
    });

    const result = await settleSeason({
      now: new Date("2026-04-26T00:00:00.000Z"),
      store,
      quotePrice: vi.fn(async () => 2),
    });

    expect(result).toMatchObject({
      status: "settled",
      season_id: "season-1",
      settled_entries: 2,
      priced_tokens: 1,
    });
    expect(store.savedPrices).toEqual([{ tokenId: "token-aero", priceUsdc: 2 }]);
    expect(store.updatedEntries).toEqual([
      {
        entryId: "entry-winner",
        values: {
          settled_portfolio_value_usdc: 13,
          settled_return_pct: 0.3,
          status: "settled",
        },
      },
      {
        entryId: "entry-cash",
        values: {
          settled_portfolio_value_usdc: 10,
          settled_return_pct: 0,
          status: "settled",
        },
      },
    ]);
    expect(store.markedSettled).toEqual({
      seasonId: "season-1",
      settledAt: "2026-04-26T00:00:00.000Z",
    });
  });

  it("does not rewrite prices or entries when already settled", async () => {
    const store = makeStore({
      season: {
        ...endedSeason,
        status: "settled",
        settled_at: "2026-04-26T00:00:00.000Z",
      },
      tokens: [{ ...aero, closing_price_usdc: 3 }],
      entries: [entry("entry-1")],
    });

    const result = await settleSeason({
      now: new Date("2026-04-26T00:10:00.000Z"),
      store,
      quotePrice: vi.fn(async () => 2),
    });

    expect(result).toMatchObject({ status: "already_settled" });
    expect(store.savedPrices).toEqual([]);
    expect(store.updatedEntries).toEqual([]);
    expect(store.markedSettled).toBeNull();
  });
});

describe("computeSettledPortfolioValue", () => {
  it("uses closing prices for open positions", () => {
    const value = computeSettledPortfolioValue({
      entry: entry("entry-1", { cash: 6 }),
      positions: [
        {
          season_entry_id: "entry-1",
          token_address: aero.token_address.toUpperCase(),
          token_amount: 2,
        },
      ],
      prices: new Map([[aero.token_address.toLowerCase(), 1.5]]),
    });

    expect(value).toBe(9);
  });
});

function entry(
  id: string,
  overrides: { cash?: number; starting?: number } = {},
) {
  return {
    id,
    cash_remaining_usdc: overrides.cash ?? 10,
    starting_balance_usdc: overrides.starting ?? 10,
    status: "active",
  };
}

function makeStore(args: {
  season: Season | null;
  tokens?: SeasonToken[];
  entries?: ReturnType<typeof entry>[];
  positions?: Array<{
    season_entry_id: string;
    token_address: string;
    token_amount: number;
  }>;
}) {
  const store = {
    savedPrices: [] as Array<{ tokenId: string; priceUsdc: number }>,
    updatedEntries: [] as Array<{
      entryId: string;
      values: {
        settled_portfolio_value_usdc: number;
        settled_return_pct: number;
        status: "settled";
      };
    }>,
    markedSettled: null as null | { seasonId: string; settledAt: string },
    async loadSettlementSeason() {
      return args.season;
    },
    async loadSeasonTokens() {
      return args.tokens ?? [];
    },
    async loadQuoteTakerAddress() {
      return "0x0000000000000000000000000000000000000001";
    },
    async saveClosingPrice(tokenId: string, priceUsdc: number) {
      store.savedPrices.push({ tokenId, priceUsdc });
    },
    async loadActiveEntries() {
      return args.entries ?? [];
    },
    async loadPositions() {
      return args.positions ?? [];
    },
    async updateEntrySettlement(
      entryId: string,
      values: {
        settled_portfolio_value_usdc: number;
        settled_return_pct: number;
        status: "settled";
      },
    ) {
      store.updatedEntries.push({ entryId, values });
    },
    async markSeasonSettled(seasonId: string, settledAt: string) {
      store.markedSettled = { seasonId, settledAt };
    },
  } satisfies SettlementStore & {
    savedPrices: Array<{ tokenId: string; priceUsdc: number }>;
    updatedEntries: Array<{
      entryId: string;
      values: {
        settled_portfolio_value_usdc: number;
        settled_return_pct: number;
        status: "settled";
      };
    }>;
    markedSettled: null | { seasonId: string; settledAt: string };
  };

  return store;
}
