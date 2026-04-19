import type { PolicyRejectionReason } from "./policy";
import type { TradeIntent } from "./intents";

/**
 * In-voice reply copy for the durable pipeline's two reply kinds.
 *
 * Farcaster caps replies at 320 graphemes. Kept short and deterministic
 * (no Date.now or locale formatting) so tests can pin exact strings.
 */

export function buildIntentReply(intent: TradeIntent): string {
  const verb = intent.action === "buy" ? "deploy" : "retire";
  const amount = intent.amount_value.toString();
  return `Decree accepted, gladiator. Commodus shall ${verb} ${amount} USDC into ${intent.symbol}. Await the arena's judgement.`;
}

export type OutcomeSuccess = {
  kind: "success";
  symbol: string;
  quantity: number;
  notionalUsdc: number;
  txHash: string;
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
    return `Victory. ${qty} ${outcome.symbol} secured for ${notional} USDC. Tx ${outcome.txHash.slice(0, 10)}…`;
  }
  return `Order failed in the arena. Reason: ${outcome.reason}.`;
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
};

/**
 * Non-policy templated rejection copy used by the workflow for states
 * that aren't a `PolicyRejectionReason` — features that have passed
 * every gate but are not yet fully wired.
 *
 * TODO(#10): remove `sell_not_yet_supported` once sell execution is
 *            implemented; sells should then flow through the full
 *            pipeline like buys.
 */
export const HANDOFF_REJECTION_COPY = {
  sell_not_yet_supported:
    "The decree is understood, gladiator, but the arena does not yet accept sales. Return when the forges of Rome are ready.",
} as const satisfies Record<string, string>;

export type HandoffRejectionReason = keyof typeof HANDOFF_REJECTION_COPY;
