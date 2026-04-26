/**
 * Floor check for season entry. The wallet's live USDC must clear the
 * season's `starting_balance_usdc` (10 USDC by default). Tiny float
 * epsilon avoids rounding-noise rejections at exactly the threshold.
 */
export function hasSufficientEntryFunding(
  walletUsdc: number,
  startingBalanceUsdc: number,
): boolean {
  return walletUsdc + 1e-9 >= startingBalanceUsdc;
}
