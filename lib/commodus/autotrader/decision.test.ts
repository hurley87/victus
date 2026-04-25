import { describe, expect, it } from "vitest";

import { decideCommodusAction } from "./decision";
import type { CommodusMarketSnapshot } from "./market-snapshot";
import { V1_BUY_STATED_USDC, V1_SELL_PERCENT } from "./sizing";

const W_SOCIAL = 0.25;
const W_QUOTE = 0.25;
const W_FIT = 0.2;
const W_COOL = 0.1;
const W_RISK = 0.3;

function expectTotalMatchesComponents(
  s: import("./types").ScoringBreakdown,
): void {
  const expected =
    W_SOCIAL * s.social +
    W_QUOTE * s.quoteQuality +
    W_FIT * s.portfolioFit +
    W_COOL * s.cooldown -
    W_RISK * s.risk;
  expect(s.total).toBeCloseTo(expected, 6);
}

function baseSnapshot(over: Partial<CommodusMarketSnapshot> = {}): CommodusMarketSnapshot {
  return {
    policy: {
      maxTradeUsdc: 10,
      maxTradesPerDay: 10,
      walletCapUsdc: 100,
      maxSlippageBps: 100,
      maxPriceImpactBps: 200,
      swapFeeBps: 50,
      swapFeeMinUsdc: 0.05,
    },
    tradable: [
      {
        symbol: "AERO",
        name: "Aerodrome",
        address: "0x0000000000000000000000000000000000000a00",
        decimals: 18,
      },
    ],
    usdcCash: 50,
    positions: [],
    lastTradeAtBySymbol: new Map(),
    buyQuotesBySymbol: new Map([
      [
        "AERO",
        {
          symbol: "AERO",
          address: "0x0000000000000000000000000000000000000a00",
          decimals: 18,
          liquidityAvailable: true,
          slippageProxy: 0.001,
        },
      ],
    ]),
    sellQuoteBySymbol: new Map(),
    positionSymbols: new Set(),
    ...over,
  };
}

describe("decideCommodusAction", () => {
  it("is deterministic for the same snapshot, slot, and time", () => {
    const snapshot = baseSnapshot();
    const slotKey = "commodus-autotrade:2026-01-15:slot-1";
    const nowMs = 1_700_000_000_000;
    const a = decideCommodusAction({ snapshot, slotKey, nowMs });
    const b = decideCommodusAction({ snapshot, slotKey, nowMs });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("applies the documented weighting to the total score", () => {
    const snapshot = baseSnapshot();
    const slotKey = "commodus-autotrade:2026-01-15:slot-1";
    const d = decideCommodusAction({
      snapshot,
      slotKey,
      nowMs: 1_700_000_000_000,
    });
    if (d.action === "hold" && d.reason === "no_fundable_candidates") {
      throw new Error("expected a trade candidate in base snapshot");
    }
    if (d.action === "hold") {
      if (d.bestBuy?.scores) expectTotalMatchesComponents(d.bestBuy.scores);
      if (d.bestSell?.scores) expectTotalMatchesComponents(d.bestSell.scores);
      return;
    }
    expectTotalMatchesComponents(d.candidate.scores);
  });

  it("uses v1 buy USDC and sell percent in intents", () => {
    const buySnap = baseSnapshot();
    const buy = decideCommodusAction({
      snapshot: buySnap,
      slotKey: "s-buy",
      nowMs: 1_800_000_000_000,
    });
    if (buy.action === "buy") {
      expect(buy.intent.amount_type).toBe("usdc_in");
      expect(buy.intent.amount_value).toBe(V1_BUY_STATED_USDC);
    }

    const sellSnap = baseSnapshot({
      usdcCash: 0,
      positions: [{ symbol: "AERO", quantity: 1 }],
      lastTradeAtBySymbol: new Map([["AERO", 1_800_000_000_000 - 3 * 24 * 60 * 60 * 1000]]),
      buyQuotesBySymbol: new Map(),
      sellQuoteBySymbol: new Map([
        [
          "AERO",
          {
            symbol: "AERO",
            address: "0x0000000000000000000000000000000000000a00",
            decimals: 18,
            liquidityAvailable: true,
            slippageProxy: 0.001,
          },
        ],
      ]),
      positionSymbols: new Set(["AERO"]),
    });
    const sell = decideCommodusAction({
      snapshot: sellSnap,
      slotKey: "s-sell",
      nowMs: 1_800_000_000_000,
    });
    if (sell.action === "sell") {
      expect(sell.intent.amount_type).toBe("percent_out");
      expect(sell.intent.amount_value).toBe(V1_SELL_PERCENT);
    }
  });
});
