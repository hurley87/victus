/**
 * Single home for user-facing Commodus copy: modern arena voice for casts,
 * rejections, execution failures, and policy gates (#16).
 */

import type { PolicyRejectionReason } from "@/lib/execution/policy";
import type { TradeIntent } from "@/lib/execution/intents";

const CHAIN_REJECTED_SWAP =
  "The trade failed onchain. Even Rome has bad plumbing. Try again or size it differently.";

export const NO_WALLET_ONBOARDING_REPLY =
  "Open the Mini App to fund your wallet, make trades in the arena, and beat Commodus to earn rewards.";

export type ExecutionFailureDetails = {
  /** Included when the failure maps to a size cap so the challenger sees the live cap. */
  maxTradeUsdc?: number;
};

/**
 * Maps `trade_executions.failure_reason` and decode/policy codes. Unknown codes
 * fall back to a generic arena failure line.
 */
export const EXECUTION_FAILURE_VOICE: Record<string, string> = {
  oversize:
    "Size it down. That order is over the single-trade limit.",
  wallet_cap:
    "Your arena wallet is at the cap. The throne is full; lighten it before you try again.",
  insufficient_balance:
    "Not enough balance for that order. Size it down or fund the arena wallet.",
  daily_rate_limit:
    "Your daily trades are spent. The arena is closed to you until the next reset.",
  needs_wallet_funding:
    "You need to fund your wallet first. Open the Mini App, fund it, then come back with conviction.",
  non_whitelisted_token:
    "That symbol is not in the arena. Pick one from the live list.",
  price_impact:
    "The market moved too hard between quote and execution. The arena rejected the slippage.",
  revert: CHAIN_REJECTED_SWAP,
  reverted: CHAIN_REJECTED_SWAP,
  decode_log_missing:
    "The chain confirmed something, but the receipt did not prove the fill. Rome does not score mysteries.",
  decode_log_mismatch:
    "The fill did not match the order. The scoreboard only respects execution.",
  unknown: "The trade failed. Rome got no useful explanation, which is rude but familiar.",
};

export function voiceForExecutionFailure(
  reason: string,
  details?: ExecutionFailureDetails,
): string {
  if (reason === "oversize" && details?.maxTradeUsdc != null) {
    return (
      `Size it down. Max single trade is ${details.maxTradeUsdc.toString()} USDC. ` +
      "The arena is not impressed by oversized paperwork."
    );
  }

  return (
    EXECUTION_FAILURE_VOICE[reason] ??
    `The trade failed: ${reason}. The scoreboard only respects execution.`
  );
}

export type OutcomeSuccess = {
  kind: "success";
  action: "buy" | "sell";
  symbol: string;
  quantity: number;
  notionalUsdc: number;
  txHash: string;
  /** Gross USDC leg on buys; gross USDC received on sells (before swap fee). */
  realizedPnlUsdc?: number;
};

export type OutcomeFailure = {
  kind: "failure";
  reason: string;
};

export type Outcome = OutcomeSuccess | OutcomeFailure;

export type CommodusVoiceContext = {
  /**
   * Farcaster handle/display label. Prefixed on intent and success outcomes
   * when non-empty.
   */
  playerLabel: string;
};

function prefixPlayer(label: string, body: string): string {
  const trimmed = label.trim();
  if (!trimmed) return body;
  return `${trimmed}. ${body}`;
}

/**
 * Intent-reply cast after policy passes and a quote is reserved — tells the
 * challenger the arena will execute on their behalf.
 */
export function buildIntentReply(
  intent: TradeIntent,
  ctx: CommodusVoiceContext,
): string {
  if (intent.action === "buy") {
    const body =
      `Order accepted. Commodus is moving ${intent.amount_value.toString()} USDC ` +
      `into ${intent.symbol}.`;
    return prefixPlayer(ctx.playerLabel, body);
  }

  const body =
    `Order accepted. Commodus is selling ${intent.amount_value.toString()}% of ` +
    `${intent.symbol}.`;
  return prefixPlayer(ctx.playerLabel, body);
}

export function buildOutcomeReply(
  outcome: Outcome,
  ctx: CommodusVoiceContext,
  executionDetails?: ExecutionFailureDetails,
): string {
  if (outcome.kind === "failure") {
    return voiceForExecutionFailure(outcome.reason, executionDetails);
  }

  const qty = outcome.quantity.toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });
  const notional = outcome.notionalUsdc.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  const pnlPart =
    outcome.action === "sell" && outcome.realizedPnlUsdc != null
      ? ` Realized PnL ${outcome.realizedPnlUsdc.toLocaleString("en-US", {
          maximumFractionDigits: 2,
          signDisplay: "exceptZero",
        })} USDC.`
      : "";

  if (outcome.action === "sell") {
    const body =
      `Executed. Sold ${qty} ${outcome.symbol} for ${notional} USDC gross.${pnlPart} ` +
      `https://basescan.org/tx/${outcome.txHash}`;
    return prefixPlayer(ctx.playerLabel, body);
  }

  const body =
    `Executed. Bought ${qty} ${outcome.symbol} for ${notional} USDC. ` +
    `https://basescan.org/tx/${outcome.txHash}`;
  return prefixPlayer(ctx.playerLabel, body);
}

export type PolicyRejectionLimits = {
  maxTradeUsdc?: number;
  walletCapUsdc?: number;
};

/**
 * Pre-submit policy denials — short lines for Farcaster; numbers match `wallet_policies`.
 */
export function policyRejectionMessage(
  reason: PolicyRejectionReason,
  limits?: PolicyRejectionLimits,
): string {
  switch (reason) {
    case "needs_wallet_funding":
      return NO_WALLET_ONBOARDING_REPLY;
    case "asset_not_whitelisted":
      return "That symbol is not in the arena. Pick one from the live list.";
    case "max_trades_per_day":
      return "Your daily trades are spent. The arena is closed to you until the next reset.";
    case "max_trade_usdc": {
      const cap =
        limits?.maxTradeUsdc != null
          ? limits.maxTradeUsdc.toString()
          : "the current";
      return `Size it down. Max single trade is ${cap} USDC.`;
    }
    case "wallet_cap_usdc": {
      const cap =
        limits?.walletCapUsdc != null
          ? limits.walletCapUsdc.toString()
          : "the cap";
      return (
        `That would push your arena wallet over the ${cap} USDC cap. ` +
        "Lighten the wallet before you posture again."
      );
    }
    case "insufficient_balance":
      return "Not enough balance. Size it down or fund the arena wallet.";
  }
}

/** @deprecated Prefer {@link policyRejectionMessage} — kept for tests pinning static keys. */
export const POLICY_REJECTION_COPY: Record<PolicyRejectionReason, string> = {
  needs_wallet_funding: policyRejectionMessage("needs_wallet_funding"),
  asset_not_whitelisted: policyRejectionMessage("asset_not_whitelisted"),
  max_trades_per_day: policyRejectionMessage("max_trades_per_day"),
  max_trade_usdc: policyRejectionMessage("max_trade_usdc", { maxTradeUsdc: 0 }),
  wallet_cap_usdc: policyRejectionMessage("wallet_cap_usdc", { walletCapUsdc: 0 }),
  insufficient_balance: policyRejectionMessage("insufficient_balance"),
};

/**
 * Parser-level rejections before policy (grammar, legacy parse paths).
 */
export type ParserRejectionReason =
  | "grammar"
  | "no_arena_wallet"
  | "non_whitelisted_token"
  | "oversize";

export const REJECTION_REPLIES: Record<ParserRejectionReason, string> = {
  grammar:
    "Bad command. Use: `buy N usdc of SYMBOL`, `sell N% of SYMBOL`, or `status`. Rome can't execute vibes.",
  no_arena_wallet:
    NO_WALLET_ONBOARDING_REPLY,
  non_whitelisted_token:
    "That symbol is not in the arena. Pick one from the live list.",
  oversize: "Size it down. That order is over the single-trade cap.",
};

export function buildAcceptedReply(amount: number, symbol: string): string {
  return `Accepted. ${amount.toString()} USDC into ${symbol}. Try not to make me regret reading that.`;
}

/** Templated (non-LLM) copy for `@commodus status` public replies — issue #13 / #20. */
export function buildStatusReplyText(params: {
  displayHandle: string;
  rank: number | null;
  points: number;
  portfolioUsdc: number;
  dailySlotsRemaining: number;
}): string {
  const rankPart =
    params.rank != null ? `rank ${params.rank}` : "no rank yet on the monthly board";
  const pts = params.points.toLocaleString("en-US");
  const usd = params.portfolioUsdc.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const slots = params.dailySlotsRemaining.toLocaleString("en-US");
  const name = params.displayHandle.trim();
  const opener = name.length > 0 ? `${name} — ` : "";
  return (
    `${opener}${rankPart}, ${pts} monthly points, ${usd} USDC in the arena wallet, ` +
    `${slots} trade${params.dailySlotsRemaining === 1 ? "" : "s"} left today. ` +
    "The scoreboard only respects execution."
  );
}
