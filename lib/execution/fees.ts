/**
 * Commodus fee-on-swap computation.
 *
 * The fee is charged on the USDC leg of every trade and funds the Privy
 * gas sponsorship balance + operator treasury (PRD § Revenue). On buys
 * it's deducted pre-quote from the notional (so the user's $5 buy spends
 * $4.975 on the asset + $0.025 in fee at 50 bps). On sells the quote is
 * full-notional and the fee is transferred out of the USDC proceeds
 * post-swap. The workflow handles the split; this helper is the one
 * canonical formula.
 *
 * Formula: `fee = max(notional * bps / 10_000, floor)`.
 *
 * The floor guards against dust trades contributing nothing — at 50 bps,
 * a $1 trade would otherwise charge $0.005, below the minimum on-chain
 * meaningful transfer. Keeping the floor per-wallet lets us tune it
 * later without a redeploy.
 */

export type ComputeFeeParams = {
  /** USDC notional of the trade (buy: USDC in; sell: USDC out). */
  notionalUsdc: number;
  /** `wallet_policies.swap_fee_bps`. */
  swapFeeBps: number;
  /** `wallet_policies.swap_fee_min_usdc`. */
  swapFeeMinUsdc: number;
};

export function computeSwapFeeUsdc(params: ComputeFeeParams): number {
  const { notionalUsdc, swapFeeBps, swapFeeMinUsdc } = params;

  if (!Number.isFinite(notionalUsdc) || notionalUsdc <= 0) {
    throw new Error("computeSwapFeeUsdc: notionalUsdc must be positive");
  }
  if (!Number.isInteger(swapFeeBps) || swapFeeBps < 0) {
    throw new Error("computeSwapFeeUsdc: swapFeeBps must be a non-negative integer");
  }
  if (!Number.isFinite(swapFeeMinUsdc) || swapFeeMinUsdc < 0) {
    throw new Error("computeSwapFeeUsdc: swapFeeMinUsdc must be non-negative");
  }

  const percentFee = (notionalUsdc * swapFeeBps) / 10_000;
  return Math.max(percentFee, swapFeeMinUsdc);
}

/**
 * For buys, 0x is quoted on the net-of-fee notional (Commodus keeps the
 * fee; the user's dollar is split fee + quoted spend). Returned value
 * can be zero if the floor consumes the entire notional — callers
 * should reject the trade as below the economic minimum in that case.
 */
export function netBuyNotionalUsdc(params: ComputeFeeParams): number {
  const fee = computeSwapFeeUsdc(params);
  return Math.max(params.notionalUsdc - fee, 0);
}
