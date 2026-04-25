import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommodusAutotraderDecision } from "./types";

const reserveAutotraderRun = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ runId: "run-1", existingStatus: null, skip: false }),
);
const buildCommodusMarketSnapshot = vi.hoisted(() => vi.fn());
const loadCommodusPlayer = vi.hoisted(() => vi.fn());
const decideCommodusAction = vi.hoisted(() => vi.fn());
const validatePolicy = vi.hoisted(() => vi.fn());
const narrateCommodusOutcome = vi.hoisted(() => vi.fn());
const publishCast = vi.hoisted(() => vi.fn());
const executeCommodusAutotrade = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }),
);

vi.mock("@/lib/commodus/autotrader/reserve", () => ({ reserveAutotraderRun }));
vi.mock("@/lib/commodus/autotrader/snapshot", () => ({ buildCommodusMarketSnapshot }));
vi.mock("@/lib/commodus/autotrader/player", () => ({ loadCommodusPlayer }));
vi.mock("@/lib/commodus/autotrader/decision", () => ({ decideCommodusAction }));
vi.mock("@/lib/commodus/autotrader/narrate", () => ({ narrateCommodusOutcome }));
vi.mock("@/lib/commodus/autotrader/execute", () => ({ executeCommodusAutotrade }));
vi.mock("@/lib/execution/policy", () => ({ validatePolicy }));
vi.mock("@/lib/neynar", () => ({
  publishCast,
  MissingSignerError: class MissingSignerError extends Error {},
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: { from } }));
vi.mock("@/lib/env", () => ({ env: { COMMODUS_FID: 999 } as Record<string, unknown> }));
vi.mock("@/lib/logger", () => ({ log: { error: vi.fn() } }));

import { runCommodusAutotrader } from "./run";

const aeroBuyScores = {
  social: 0.2,
  quoteQuality: 0.8,
  portfolioFit: 0.5,
  cooldown: 0.5,
  risk: 0.2,
  total: 0.3,
};

const buyDecision: Extract<CommodusAutotraderDecision, { action: "buy" }> = {
  action: "buy",
  reason: "scored_buy",
  intent: {
    action: "buy",
    symbol: "AERO",
    amount_type: "usdc_in",
    amount_value: 1,
  },
  candidate: {
    kind: "buy",
    symbol: "AERO",
    sizeUsdcOrPercent: 1,
    scores: aeroBuyScores,
    quoteLiquidityAvailable: true,
    quoteSlippageProxy: 0,
  },
  bestBuy: {
    kind: "buy",
    symbol: "AERO",
    sizeUsdcOrPercent: 1,
    scores: aeroBuyScores,
    quoteLiquidityAvailable: true,
    quoteSlippageProxy: 0,
  },
  bestSell: null,
};

describe("runCommodusAutotrader — policy reject → hold cast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCommodusPlayer.mockResolvedValue({
      userId: "user-1",
      fid: 999,
      walletId: "w1",
      walletAddress: "0x0000000000000000000000000000000000000001",
      privyWalletId: "privy-1",
    });
    buildCommodusMarketSnapshot.mockResolvedValue({
      policy: {
        maxTradeUsdc: 10,
        maxTradesPerDay: 3,
        walletCapUsdc: 100,
        maxSlippageBps: 100,
        maxPriceImpactBps: 200,
        swapFeeBps: 50,
        swapFeeMinUsdc: 0.05,
      },
      tradable: [],
      usdcCash: 5,
      positions: [],
      lastTradeAtBySymbol: new Map(),
      buyQuotesBySymbol: new Map(),
      sellQuoteBySymbol: new Map(),
      positionSymbols: new Set(),
    });
    decideCommodusAction.mockReturnValue(buyDecision);
    validatePolicy.mockResolvedValue({ ok: false, reason: "max_trades_per_day" });
    narrateCommodusOutcome.mockResolvedValue("A measured silence.");
    publishCast.mockResolvedValue({ hash: "0xabc" });
  });

  it("does not call execute; publishes a hold narrative", async () => {
    const r = await runCommodusAutotrader({
      slotKey: "commodus-autotrade:2026-04-25:slot-1",
      dryRun: false,
    });
    expect(r.status).toBe("hold_posted");
    expect(validatePolicy).toHaveBeenCalled();
    expect(executeCommodusAutotrade).not.toHaveBeenCalled();
    expect(narrateCommodusOutcome).toHaveBeenCalled();
    expect(publishCast).toHaveBeenCalled();
  });
});
