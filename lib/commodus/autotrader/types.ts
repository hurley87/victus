import type { PolicyRejectionReason } from "@/lib/execution/policy";
import type { TradeIntent } from "@/lib/execution/intents";

export type CommodusAutotraderStatus =
  | "pending"
  | "in_progress"
  | "hold_posted"
  | "executed"
  | "failed"
  | "dry_run"
  | "skipped";

export type ScoringBreakdown = {
  social: number;
  quoteQuality: number;
  portfolioFit: number;
  cooldown: number;
  risk: number;
  total: number;
};

export type CommodusCandidateKind = "buy" | "sell";

export type CommodusCandidate = {
  kind: CommodusCandidateKind;
  symbol: string;
  /**
   * BUY: USDC in (full command amount before policy fee split).
   * SELL: percent 1..100.
   */
  sizeUsdcOrPercent: number;
  scores: ScoringBreakdown;
  quoteLiquidityAvailable: boolean;
  /** 0x price / guaranteedPrice - 1 when both present, else 0. */
  quoteSlippageProxy: number;
};

export type CommodusAutotraderDecision =
  | {
      action: "hold";
      reason: string;
      bestBuy: CommodusCandidate | null;
      bestSell: CommodusCandidate | null;
    }
  | {
      action: "buy";
      reason: string;
      intent: TradeIntent;
      candidate: CommodusCandidate;
      bestBuy: CommodusCandidate;
      bestSell: CommodusCandidate | null;
    }
  | {
      action: "sell";
      reason: string;
      intent: TradeIntent;
      candidate: CommodusCandidate;
      bestBuy: CommodusCandidate | null;
      bestSell: CommodusCandidate;
    };

export type CommodusPlayer = {
  userId: string;
  fid: number;
  walletId: string;
  walletAddress: string;
  privyWalletId: string;
};

export type CommodusNarrativeKind =
  | "hold"
  | "hold_policy"
  | "hold_failed"
  | "buy"
  | "sell";

export type CommodusAnalysisForNarration = {
  kind: CommodusNarrativeKind;
  slotKey: string;
  /** ISO date YYYY-MM-DD for the slot. */
  slotDate: string;
  decision: CommodusAutotraderDecision;
  policyRejection?: PolicyRejectionReason;
  fill?: {
    txHash: string;
    symbol: string;
    action: "buy" | "sell";
    notionalUsdc: number;
  };
  /** Human-readable one-line for logging / JSON analysis field. */
  trace: string;
};
