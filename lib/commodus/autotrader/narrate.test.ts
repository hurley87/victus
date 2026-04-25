import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommodusAutotraderDecision, CommodusAnalysisForNarration } from "./types";

const testEnv = vi.hoisted(() => ({
  OPENAI_API_KEY: undefined as string | undefined,
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
    testEnv.OPENAI_API_KEY = undefined;
    testEnv.AI_GATEWAY_API_KEY = undefined;
  });

  it("uses fallback when no LLM keys are configured", async () => {
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
  });

  it("falls back when generateText keeps failing", async () => {
    testEnv.OPENAI_API_KEY = "k-test";
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
