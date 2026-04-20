import { voiceForExecutionFailure } from "@/lib/commodus-voice";

import type { PolicyRejectionReason } from "./policy";
import type { TradeIntent } from "./intents";

/**
 * In-voice reply copy for the durable pipeline's two reply kinds.
 *
 * Farcaster caps replies at 320 graphemes. Kept short and deterministic
 * (no Date.now or locale formatting) so tests can pin exact strings.
 */

export function buildIntentReply(intent: TradeIntent): string {
  if (intent.action === "buy") {
    return (
      `Decree accepted, gladiator. Commodus shall deploy ${intent.amount_value} USDC into ` +
      `${intent.symbol}. Await the arena's judgement.`
    );
  }
  return (
    `Decree accepted, gladiator. Commodus shall retire ${intent.amount_value}% of ` +
    `${intent.symbol}. Await the arena's judgement.`
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

export function buildOutcomeReply(outcome: Outcome): string {
  if (outcome.kind === "success") {
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
      return (
        `Victory. Retired ${qty} ${outcome.symbol} for ${notional} USDC gross.${pnlPart} ` +
        `Tx ${outcome.txHash.slice(0, 10)}…`
      );
    }

    return `Victory. ${qty} ${outcome.symbol} secured for ${notional} USDC. Tx ${outcome.txHash.slice(0, 10)}…`;
  }
  return voiceForExecutionFailure(outcome.reason);
}

export const POLICY_REJECTION_COPY: Record<PolicyRejectionReason, string> = {
  needs_gladiator_mint:
    "Ascend the gladiator's gate first. Mint your gladiator in the Mini App before issuing decrees.",
  asset_not_whitelisted:
    "Order denied. The named asset does not fight in this arena.",
  max_trades_per_day:
    "Order denied. Thy daily allotment of decrees is spent. Return at dawn.",
  max_trade_usdc:
    "Order denied. The decree exceeds thy allotted size for a single trade.",
  wallet_cap_usdc:
    "Order denied. Thy arena coffers have reached their cap. Withdraw before deploying more.",
  insufficient_balance:
    "Order denied. Thy position in that asset is too small for this decree.",
};
