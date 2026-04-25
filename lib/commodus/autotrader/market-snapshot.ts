/**
 * Pure snapshot types + heuristics (no I/O) so `decision.ts` and Vitest
 * do not import the server `snapshot` module that pulls env/chain.
 */

export type PolicySnapshot = {
  maxTradeUsdc: number;
  maxTradesPerDay: number;
  walletCapUsdc: number;
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  swapFeeBps: number;
  swapFeeMinUsdc: number;
};

export type TokenQuoteSnapshot = {
  symbol: string;
  address: string;
  decimals: number;
  liquidityAvailable: boolean;
  /** |guaranteedPrice - price| / price when both exist, else 0. */
  slippageProxy: number;
};

export type PositionSnapshot = {
  symbol: string;
  quantity: number;
};

/** Whitelist row; matches `TradableAsset` in `lib/chain/balances` structurally. */
export type TradableAssetRow = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
};

export type CommodusMarketSnapshot = {
  policy: PolicySnapshot;
  tradable: TradableAssetRow[];
  usdcCash: number;
  positions: PositionSnapshot[];
  /** Last confirmed trade time per symbol (ms), for cooldown. */
  lastTradeAtBySymbol: Map<string, number>;
  /** Pre-fetched 0x quotes for BUY 1 USDC (stated) → asset. */
  buyQuotesBySymbol: Map<string, TokenQuoteSnapshot>;
  sellQuoteBySymbol: Map<string, TokenQuoteSnapshot>;
  positionSymbols: Set<string>;
};

/**
 * Mark-to-rough-value of holdings in USDC using the buy-quote path is expensive;
 * decision uses a simple concentration heuristic instead.
 */
export function estimateExposureConcentration(
  snapshot: CommodusMarketSnapshot,
): number {
  const n = snapshot.positionSymbols.size;
  if (n === 0) return 0;
  return Math.min(1, 1 / n);
}
