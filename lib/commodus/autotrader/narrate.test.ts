import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommodusAutotraderDecision, CommodusAnalysisForNarration } from "./types";

const testEnv = vi.hoisted(() => ({
  AI_GATEWAY_API_KEY: undefined as string | undefined,
}));

vi.mock("@/lib/env", () => ({ env: testEnv }));

import { fallbackNarration, narrateCommodusOutcome } from "./narrate";

const zeroScores = {
  social: 0,
  quoteQuality: 0,
  portfolioFit: 0,
  cooldown: 0,
  risk: 0,
  total: 0,
} as const;

function holdDecision(reason: string): CommodusAutotraderDecision {
  return {
    action: "hold",
    reason,
    bestBuy: null,
    bestSell: null,
  };
}

const stubBuyLeg = {
  kind: "buy" as const,
  symbol: "AERO",
  sizeUsdcOrPercent: 1,
  scores: { ...zeroScores },
  quoteLiquidityAvailable: true,
  quoteSlippageProxy: 0,
};

describe("fallbackNarration", () => {
  it("covers policy hold with a stable template", () => {
    const a: CommodusAnalysisForNarration = {
      kind: "hold",
      slotKey: "k",
      slotDate: "2026-01-01",
      decision: holdDecision("x"),
      policyRejection: "max_trades_per_day",
      trace: "t",
    };
    const t = fallbackNarration(a);
    expect(t).toContain("max_trades_per_day");
    expect(t.length).toBeLessThanOrEqual(320);
  });

  it("covers successful fill with tx fragment", () => {
    const a: CommodusAnalysisForNarration = {
      kind: "buy",
      slotKey: "k",
      slotDate: "2026-01-01",
      decision: {
        action: "buy",
        reason: "ok",
        intent: {
          action: "buy",
          symbol: "AERO",
          amount_type: "usdc_in",
          amount_value: 1,
        },
        candidate: { ...stubBuyLeg },
        bestBuy: { ...stubBuyLeg },
        bestSell: null,
      },
      fill: {
        action: "buy",
        symbol: "AERO",
        notionalUsdc: 1,
        txHash: "0x" + "ab".repeat(32),
      },
      trace: "t",
    };
    const t = fallbackNarration(a);
    expect(t).toMatch(/AERO|basescan/i);
  });
});

describe("narrateCommodusOutcome", () => {
  beforeEach(() => {
    testEnv.AI_GATEWAY_API_KEY = undefined;
  });

  it("uses fallback when no LLM keys are configured", async () => {
    const prevOidc = process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;
    try {
      const a: CommodusAnalysisForNarration = {
        kind: "hold",
        slotKey: "k",
        slotDate: "2026-01-01",
        decision: {
          action: "hold",
          reason: "weak_buy_signal",
          bestBuy: null,
          bestSell: null,
        },
        trace: "t",
      };
      const out = await narrateCommodusOutcome(a);
      expect(out).toBe(fallbackNarration(a));
    } finally {
      if (prevOidc !== undefined) process.env.VERCEL_OIDC_TOKEN = prevOidc;
    }
  });

  it("does not leak runner-up tickers into the LLM prompt", async () => {
    testEnv.AI_GATEWAY_API_KEY = "k-test";
    const a: CommodusAnalysisForNarration = {
      kind: "buy",
      slotKey: "k",
      slotDate: "2026-01-01",
      decision: {
        action: "buy",
        reason: "scored_buy",
        intent: {
          action: "buy",
          symbol: "AERO",
          amount_type: "usdc_in",
          amount_value: 1,
        },
        candidate: { ...stubBuyLeg },
        bestBuy: { ...stubBuyLeg },
        bestSell: {
          kind: "sell",
          symbol: "VIRTUAL",
          sizeUsdcOrPercent: 50,
          scores: { ...zeroScores },
          quoteLiquidityAvailable: true,
          quoteSlippageProxy: 0,
        },
      },
      trace: "t",
    };
    let seenPrompt = "";
    const generate = vi.fn(async (args: { prompt: string }) => {
      seenPrompt = args.prompt;
      return { output: { text: "I bought $AERO." } };
    });
    await narrateCommodusOutcome(a, { generate: generate as never });
    expect(seenPrompt).not.toContain("VIRTUAL");
    expect(seenPrompt).not.toContain("bestSell");
    expect(seenPrompt).not.toContain("bestBuy");
    expect(seenPrompt).toContain("AERO");
  });

  it("falls back when generateText keeps failing", async () => {
    testEnv.AI_GATEWAY_API_KEY = "k-test";
    const a: CommodusAnalysisForNarration = {
      kind: "hold",
      slotKey: "k",
      slotDate: "2026-01-01",
      decision: {
        action: "hold",
        reason: "weak",
        bestBuy: null,
        bestSell: null,
      },
      trace: "t",
    };
    const badGenerate = vi.fn().mockRejectedValue(new Error("network"));
    const out = await narrateCommodusOutcome(a, { generate: badGenerate as never });
    expect(badGenerate).toHaveBeenCalled();
    expect(out).toBe(fallbackNarration(a));
  });
});
