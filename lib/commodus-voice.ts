/**
 * Single home for user-facing Commodus copy — Roman arena voice for casts,
 * rejections, execution failures, and policy gates (#16).
 */

import type { PolicyRejectionReason } from "@/lib/execution/policy";
import type { TradeIntent } from "@/lib/execution/intents";

const CHAIN_REJECTED_SWAP =
  "The sands reject the swap — the chain reverted. Another gambit may fare better.";

export type ExecutionFailureDetails = {
  /** Inscribed when the failure maps to a size cap so the citizen sees the live cap. */
  maxTradeUsdc?: number;
};

/**
 * Maps `trade_executions.failure_reason` and decode/policy codes. Unknown codes
 * fall back to a generic arena failure line.
 */
export const EXECUTION_FAILURE_VOICE: Record<string, string> = {
  oversize:
    "The decree exceeds thy single-trade limit — trim the sum to the arena law allows.",
  wallet_cap:
    "Thy arena treasury overflows its cap. No further trades until the ledgers cool.",
  insufficient_balance:
    "Thy coffers hold too little of that token for this decree. Fund or downsize.",
  daily_rate_limit:
    "Thy daily tally of arena trades is spent. Return when the sun crosses again.",
  needs_gladiator_mint:
    "Thou hast no fighter in the lists. Mint thy gladiator in the Mini App, then return.",
  non_whitelisted_token:
    "That token is not admitted to these sands. Name a listed champion only.",
  price_impact:
    "The market turned too fierce between quote and strike — the trade could not stand.",
  revert: CHAIN_REJECTED_SWAP,
  reverted: CHAIN_REJECTED_SWAP,
  decode_log_missing:
    "The arena could not read victory from the chain receipt — the scribes were silent.",
  decode_log_mismatch:
    "The fill did not match the plotted course — call off the heralds and await word.",
  unknown: "The duel is undone. The reason remains unknown.",
};

export function voiceForExecutionFailure(
  reason: string,
  details?: ExecutionFailureDetails,
): string {
  if (reason === "oversize" && details?.maxTradeUsdc != null) {
    return (
      `The decree exceeds thy ${details.maxTradeUsdc.toString()} USDC single-trade limit. ` +
      "Name a smaller sum, or the gates stay barred."
    );
  }

  return (
    EXECUTION_FAILURE_VOICE[reason] ??
    `The duel falters: ${reason}. Commodus shall speak when the omen clears.`
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
   * Display name from `gladiators.name`, e.g. "Maximus". Prefixed on intent
   * and success outcomes when non-empty.
   */
  gladiatorName: string;
};

function prefixGladiator(name: string, body: string): string {
  const n = name.trim();
  if (!n) return body;
  return `${n}. ${body}`;
}

/**
 * Intent-reply cast after policy passes and a quote is reserved — tells the
 * citizen the arena will execute on their behalf.
 */
export function buildIntentReply(
  intent: TradeIntent,
  ctx: CommodusVoiceContext,
): string {
  if (intent.action === "buy") {
    const body =
      `Thy decree stands. Commodus shall march ${intent.amount_value.toString()} USDC ` +
      `into ${intent.symbol} from thy arena coffers. Stand ready for the trumpet.`;
    return prefixGladiator(ctx.gladiatorName, body);
  }

  const body =
    `Thy decree stands. Commodus shall retire ${intent.amount_value.toString()}% of ` +
    `${intent.symbol} from thy shield hand, per thy word. Await the proclamation.`;
  return prefixGladiator(ctx.gladiatorName, body);
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
      `Victory. Struck ${qty} ${outcome.symbol} into ${notional} USDC gross.${pnlPart} ` +
      `Proof: ${outcome.txHash.slice(0, 10)}…`;
    return prefixGladiator(ctx.gladiatorName, body);
  }

  const body =
    `Victory. Claimed ${qty} ${outcome.symbol} for ${notional} USDC. ` +
    `Proof: ${outcome.txHash.slice(0, 10)}…`;
  return prefixGladiator(ctx.gladiatorName, body);
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
    case "needs_gladiator_mint":
      return (
        "The lists are barred. Mint thy gladiator and fund the arena wallet in the Mini App, " +
        "then issue thy decree."
      );
    case "asset_not_whitelisted":
      return "That symbol is not matched against our scroll of admitted tokens. Name a listed champion.";
    case "max_trades_per_day":
      return "Thy daily count of arena trades is spent. Rest until the morrow's trumpet.";
    case "max_trade_usdc": {
      const cap =
        limits?.maxTradeUsdc != null
          ? limits.maxTradeUsdc.toString()
          : "the law";
      return (
        `Thy decree exceeds the ${cap} USDC limit for a single passage. ` +
        "Shave thy sum and cast again."
      );
    }
    case "wallet_cap_usdc": {
      const cap =
        limits?.walletCapUsdc != null
          ? limits.walletCapUsdc.toString()
          : "the cap";
      return (
        `Thy custodied treasure—including arms still held—would breach the ${cap} USDC ` +
        "wallet ceiling. Lighten the vault before the next charge."
      );
    }
    case "insufficient_balance":
      return "That stake is too lean for this decree. Claim a smaller share or gather more blades.";
  }
}

/** @deprecated Prefer {@link policyRejectionMessage} — kept for tests pinning static keys. */
export const POLICY_REJECTION_COPY: Record<PolicyRejectionReason, string> = {
  needs_gladiator_mint: policyRejectionMessage("needs_gladiator_mint"),
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
    "Speak as Rome taught thee. Valid decrees: `buy N usdc of SYMBOL`, `sell N% of SYMBOL`, `status`.",
  no_arena_wallet:
    "Commodus trades on thy behalf from thy arena wallet. Enter the Mini App and mint thy gladiator first.",
  non_whitelisted_token:
    "That token is not yoked to these games. Name a champion from the live list in the Mini App.",
  oversize: "Thy sum overshoots the proconsul's cap for a single trade. Name a smaller tally.",
};

export function buildAcceptedReply(amount: number, symbol: string): string {
  return `Hark — accepted. ${amount.toString()} USDC shall march into ${symbol}.`;
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
    `${opener}Commodus reads ${rankPart}, ${pts} monthly points, ${usd} USDC in the arena vault, ` +
    `${slots} trade${params.dailySlotsRemaining === 1 ? "" : "s"} left this day.`
  );
}
