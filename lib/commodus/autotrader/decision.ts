import type { TradeIntent } from "@/lib/execution/intents";

import {
  estimateExposureConcentration,
  type CommodusMarketSnapshot,
} from "./market-snapshot";
import { V1_BUY_STATED_USDC, V1_SELL_PERCENT } from "./sizing";
import type {
  CommodusAutotraderDecision,
  CommodusCandidate,
  ScoringBreakdown,
} from "./types";

const W_SOCIAL = 0.25;
const W_QUOTE = 0.25;
const W_FIT = 0.2;
const W_COOL = 0.1;
const W_RISK = 0.3;

/** Below this total score, prefer HOLD (weak signal). */
const HOLD_SCORE_FLOOR = 0.12;

function stable01(slotKey: string, symbol: string, salt: string): number {
  let h = 2166136261;
  const s = `${slotKey}:${symbol}:${salt}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

function daysSinceLastTradeMs(
  lastBySymbol: Map<string, number>,
  symbol: string,
  nowMs: number,
): number {
  const t = lastBySymbol.get(symbol);
  if (t == null) return 10_000; // "never" → high cooldown
  return (nowMs - t) / (24 * 60 * 60 * 1000);
}

function buildScores(params: {
  social: number;
  quoteQuality: number;
  portfolioFit: number;
  cooldown: number;
  risk: number;
}): ScoringBreakdown {
  const total =
    W_SOCIAL * params.social +
    W_QUOTE * params.quoteQuality +
    W_FIT * params.portfolioFit +
    W_COOL * params.cooldown -
    W_RISK * params.risk;
  return {
    social: params.social,
    quoteQuality: params.quoteQuality,
    portfolioFit: params.portfolioFit,
    cooldown: params.cooldown,
    risk: params.risk,
    total,
  };
}

/**
 * Deterministic: same snapshot + slotKey always yields the same decision.
 * Does not call policy / chain — the runner applies `validatePolicy` after.
 */
export function decideCommodusAction(params: {
  snapshot: CommodusMarketSnapshot;
  slotKey: string;
  nowMs: number;
}): CommodusAutotraderDecision {
  const { snapshot, slotKey, nowMs } = params;
  const { policy, lastTradeAtBySymbol, buyQuotesBySymbol, sellQuoteBySymbol } =
    snapshot;

  const conc = estimateExposureConcentration(snapshot);
  const roughExposure =
    snapshot.usdcCash + snapshot.positions.length * 3; // cheap heuristic, policy is authoritative
  const exposureRatio = Math.min(1, roughExposure / Math.max(1, policy.walletCapUsdc));

  const buyCandidates: CommodusCandidate[] = [];

  if (snapshot.usdcCash >= V1_BUY_STATED_USDC) {
    for (const asset of snapshot.tradable) {
      const q = buyQuotesBySymbol.get(asset.symbol);
      if (!q) continue;
      const social = stable01(slotKey, asset.symbol, "social");
      const quoteQuality = q.liquidityAvailable
        ? Math.max(0, 1 - Math.min(1, q.slippageProxy * 50))
        : 0;
      const hasPos = snapshot.positionSymbols.has(asset.symbol);
      const portfolioFit = hasPos
        ? 0.4 + 0.2 * (1 - conc)
        : 0.7 + 0.3 * (1 - conc);
      const days = daysSinceLastTradeMs(lastTradeAtBySymbol, asset.symbol, nowMs);
      const cooldown = Math.min(1, days / 2);
      const risk = Math.min(
        1,
        0.6 * exposureRatio + 0.4 * (hasPos ? 0.5 : 0.15) + V1_BUY_STATED_USDC / policy.walletCapUsdc,
      );
      const scores = buildScores({
        social,
        quoteQuality,
        portfolioFit,
        cooldown,
        risk,
      });
      buyCandidates.push({
        kind: "buy",
        symbol: asset.symbol,
        sizeUsdcOrPercent: V1_BUY_STATED_USDC,
        scores,
        quoteLiquidityAvailable: q.liquidityAvailable,
        quoteSlippageProxy: q.slippageProxy,
      });
    }
  }

  const sellCandidates: CommodusCandidate[] = [];
  for (const p of snapshot.positions) {
    if (p.quantity <= 0) continue;
    const q = sellQuoteBySymbol.get(p.symbol);
    if (!q) continue;
    const social = stable01(slotKey, p.symbol, "sell_social");
    const quoteQuality = q.liquidityAvailable
      ? Math.max(0, 1 - Math.min(1, q.slippageProxy * 50))
      : 0;
    const portfolioFit = 0.75; // rebalancing / maintenance
    const days = daysSinceLastTradeMs(lastTradeAtBySymbol, p.symbol, nowMs);
    const cooldown = Math.min(1, days / 2);
    const risk = 0.35; // sell reduces risk
    const scores = buildScores({
      social,
      quoteQuality,
      portfolioFit,
      cooldown,
      risk,
    });
    sellCandidates.push({
      kind: "sell",
      symbol: p.symbol,
      sizeUsdcOrPercent: V1_SELL_PERCENT,
      scores,
      quoteLiquidityAvailable: q.liquidityAvailable,
      quoteSlippageProxy: q.slippageProxy,
    });
  }

  const bestBuy =
    buyCandidates.length === 0
      ? null
      : buyCandidates.reduce((a, b) => (a.scores.total >= b.scores.total ? a : b));
  const bestSell =
    sellCandidates.length === 0
      ? null
      : sellCandidates.reduce((a, b) => (a.scores.total >= b.scores.total ? a : b));

  if (bestBuy == null && bestSell == null) {
    return {
      action: "hold",
      reason: "no_fundable_candidates",
      bestBuy: null,
      bestSell: null,
    };
  }

  if (bestBuy == null) {
    if (
      (bestSell?.scores.total ?? 0) < HOLD_SCORE_FLOOR ||
      !bestSell?.quoteLiquidityAvailable
    ) {
      return {
        action: "hold",
        reason: "weak_sell_signal",
        bestBuy: null,
        bestSell,
      };
    }
    const intent: TradeIntent = {
      action: "sell",
      symbol: bestSell.symbol,
      amount_type: "percent_out",
      amount_value: V1_SELL_PERCENT,
    };
    return {
      action: "sell",
      reason: "scored_sell",
      intent,
      candidate: bestSell,
      bestBuy: null,
      bestSell,
    };
  }

  if (bestSell == null) {
    if ((bestBuy.scores.total) < HOLD_SCORE_FLOOR || !bestBuy.quoteLiquidityAvailable) {
      return {
        action: "hold",
        reason: "weak_buy_signal",
        bestBuy,
        bestSell: null,
      };
    }
    const intent: TradeIntent = {
      action: "buy",
      symbol: bestBuy.symbol,
      amount_type: "usdc_in",
      amount_value: V1_BUY_STATED_USDC,
    };
    return {
      action: "buy",
      reason: "scored_buy",
      intent,
      candidate: bestBuy,
      bestBuy,
      bestSell: null,
    };
  }

  const pickBuy = bestBuy.scores.total > bestSell.scores.total;
  if (pickBuy) {
    if (bestBuy.scores.total < HOLD_SCORE_FLOOR || !bestBuy.quoteLiquidityAvailable) {
      return { action: "hold", reason: "weak_buy_signal", bestBuy, bestSell };
    }
    const intent: TradeIntent = {
      action: "buy",
      symbol: bestBuy.symbol,
      amount_type: "usdc_in",
      amount_value: V1_BUY_STATED_USDC,
    };
    return {
      action: "buy",
      reason: "scored_buy",
      intent,
      candidate: bestBuy,
      bestBuy,
      bestSell,
    };
  }

  if (bestSell.scores.total < HOLD_SCORE_FLOOR || !bestSell.quoteLiquidityAvailable) {
    return { action: "hold", reason: "weak_sell_signal", bestBuy, bestSell };
  }
  const intent: TradeIntent = {
    action: "sell",
    symbol: bestSell.symbol,
    amount_type: "percent_out",
    amount_value: V1_SELL_PERCENT,
  };
  return {
    action: "sell",
    reason: "scored_sell",
    intent,
    candidate: bestSell,
    bestBuy,
    bestSell,
  };
}
