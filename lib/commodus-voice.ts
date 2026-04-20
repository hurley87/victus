/**
 * Commodus outcome copy for execution-time failures (#12).
 *
 * Maps `trade_executions.failure_reason` and decode/policy codes to short,
 * in-voice lines. Unknown codes fall back to a generic arena failure line.
 */

const CHAIN_REJECTED_SWAP =
  "Order failed in the arena. Reason: the chain rejected the swap.";

export const EXECUTION_FAILURE_VOICE: Record<string, string> = {
  oversize: "Order failed in the arena. Reason: the decree exceeded thy single-trade limit.",
  wallet_cap: "Order failed in the arena. Reason: thy arena coffers exceed their cap.",
  insufficient_balance:
    "Order failed in the arena. Reason: insufficient balance for that decree.",
  daily_rate_limit:
    "Order failed in the arena. Reason: thy daily allotment of decrees is spent.",
  needs_gladiator_mint:
    "Order failed in the arena. Reason: mint thy gladiator before trading.",
  non_whitelisted_token:
    "Order failed in the arena. Reason: a token in the fill is not approved for this arena.",
  price_impact:
    "Order failed in the arena. Reason: price moved too sharply against thee.",
  revert: CHAIN_REJECTED_SWAP,
  reverted: CHAIN_REJECTED_SWAP,
  decode_log_missing:
    "Order failed in the arena. Reason: the arena could not read the swap receipt.",
  decode_log_mismatch:
    "Order failed in the arena. Reason: the fill did not match the quoted path.",
  unknown: "Order failed in the arena. Reason: unknown.",
};

export function voiceForExecutionFailure(reason: string): string {
  return (
    EXECUTION_FAILURE_VOICE[reason] ??
    `Order failed in the arena. Reason: ${reason}.`
  );
}
