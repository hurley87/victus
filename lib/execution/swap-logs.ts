import {
  erc20Abi,
  formatUnits,
  getAddress,
  parseEventLogs,
  type Address,
  type Log,
} from "viem";

import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";

/**
 * Pure ERC-20 `Transfer`-log decoder for a confirmed 0x Allowance Holder
 * swap receipt.
 *
 * Callers pass the `logs` from an already-fetched `TransactionReceipt`
 * (no RPC here — keep this module trivially unit-testable against canned
 * fixtures). The helper sums `Transfer(from, to, value)` events per
 * token, filtered to the USDC <-> asset pair we care about, and returns
 * the *net* flows in and out of the arena wallet.
 *
 * Both buy (`usdc_to_asset`) and sell (`asset_to_usdc`) directions are
 * supported; callers pass `direction` explicitly so the netting math is
 * never ambiguous.
 *
 * Multi-hop caveat: aggregators typically route through one or two
 * intermediate pool contracts, so the same token can appear on multiple
 * `Transfer` logs for a single swap (e.g. `Router -> Pool`, `Pool -> Wallet`).
 * We only care about the arena wallet's net flow per token, so summing
 * `to == wallet` minus `from == wallet` collapses any number of hops
 * into the single realized fill number we need.
 */

export type SwapDirection = "usdc_to_asset" | "asset_to_usdc";

export interface DecodeSwapReceiptParams {
  walletAddress: string;
  assetAddress: string;
  assetDecimals: number;
  /** Defaults to `"usdc_to_asset"` (buy). Sell is tracked by #10. */
  direction?: SwapDirection;
}

/**
 * Minimal shape required to decode a swap — the full `TransactionReceipt`
 * type from viem is wide and tied to chain-specific generics, so we only
 * depend on the `logs` field. Tests feed hand-rolled fixtures in here.
 */
export interface SwapReceiptLike {
  logs: readonly Log[];
}

export interface DecodedSwap {
  direction: SwapDirection;
  /** Raw USDC base units that left (buy) or arrived at (sell) the wallet. */
  usdcBaseUnits: bigint;
  /** Raw asset base units that arrived at (buy) or left (sell) the wallet. */
  assetBaseUnits: bigint;
  /**
   * Full-precision decimal string, safe to write directly into a
   * `numeric(38, 18)` Postgres column without float coercion.
   */
  quantity: string;
  /** Full-precision decimal string; see {@link DecodedSwap.quantity}. */
  executionPriceUsdc: string;
  /** Float convenience field for outcome-reply copy (lossy on extremes). */
  quantityNumber: number;
  /** Float convenience field for outcome-reply copy (lossy on extremes). */
  executionPriceUsdcNumber: number;
  /** Float convenience field for the realized USDC notional (lossy on extremes). */
  usdcHumanNumber: number;
}

/**
 * Thrown when the receipt has no matching `Transfer` events to derive
 * the realized fill. Callers should translate to a terminal failure
 * with `failure_reason='decode_log_missing'` and a failure outcome reply.
 */
export class SwapLogMissingError extends Error {
  readonly reason = "decode_log_missing" as const;

  constructor(message?: string) {
    super(message ?? "decode_swap_log: no matching Transfer events on receipt");
    this.name = "SwapLogMissingError";
  }
}

/** Price-precision floor for the `numeric(38, 18)` column. */
const PRICE_FRACTION_DIGITS = 18;

export function decodeSwapReceipt(
  receipt: SwapReceiptLike,
  params: DecodeSwapReceiptParams,
): DecodedSwap {
  const direction: SwapDirection = params.direction ?? "usdc_to_asset";

  const wallet = getAddress(params.walletAddress);
  const usdc = USDC_BASE_ADDRESS;
  const asset = getAddress(params.assetAddress);

  if (asset === usdc) {
    // A whitelisted asset identical to USDC is not a meaningful swap
    // pair and would also collapse the per-token accounting below.
    throw new Error("decodeSwapReceipt: asset address equals USDC");
  }

  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: [...receipt.logs],
    // Don't throw on foreign or malformed logs — Allowance Holder swaps
    // frequently emit non-Transfer events we have no business decoding.
    strict: false,
  });

  const zero = BigInt(0);
  let usdcOut = zero;
  let usdcIn = zero;
  let assetIn = zero;
  let assetOut = zero;

  for (const log of transfers) {
    const token = safeGetAddress(log.address);
    if (!token) continue;

    const args = log.args as {
      from?: Address;
      to?: Address;
      value?: bigint;
    };
    const from = args.from ? safeGetAddress(args.from) : null;
    const to = args.to ? safeGetAddress(args.to) : null;
    const value = args.value;
    if (value === undefined || from === null || to === null) continue;

    if (token === usdc) {
      if (from === wallet) usdcOut += value;
      if (to === wallet) usdcIn += value;
    } else if (token === asset) {
      if (to === wallet) assetIn += value;
      if (from === wallet) assetOut += value;
    }
  }

  const netUsdcOut = usdcOut - usdcIn;
  const netUsdcIn = usdcIn - usdcOut;
  const netAssetIn = assetIn - assetOut;
  const netAssetOut = assetOut - assetIn;

  if (direction === "usdc_to_asset") {
    if (netUsdcOut <= zero || netAssetIn <= zero) {
      throw new SwapLogMissingError();
    }

    const quantity = formatUnits(netAssetIn, params.assetDecimals);
    const usdcHuman = formatUnits(netUsdcOut, USDC_DECIMALS);
    const executionPriceUsdc = computePriceUsdc({
      usdcBaseUnits: netUsdcOut,
      assetBaseUnits: netAssetIn,
      assetDecimals: params.assetDecimals,
    });

    return {
      direction,
      usdcBaseUnits: netUsdcOut,
      assetBaseUnits: netAssetIn,
      quantity,
      executionPriceUsdc,
      quantityNumber: Number(quantity),
      executionPriceUsdcNumber: Number(executionPriceUsdc),
      usdcHumanNumber: Number(usdcHuman),
    };
  }

  // asset_to_usdc — arena sends asset, receives USDC (symmetric netting).
  if (netAssetOut <= zero || netUsdcIn <= zero) {
    throw new SwapLogMissingError();
  }

  const quantity = formatUnits(netAssetOut, params.assetDecimals);
  const usdcHuman = formatUnits(netUsdcIn, USDC_DECIMALS);
  const executionPriceUsdc = computePriceUsdc({
    usdcBaseUnits: netUsdcIn,
    assetBaseUnits: netAssetOut,
    assetDecimals: params.assetDecimals,
  });

  return {
    direction,
    usdcBaseUnits: netUsdcIn,
    assetBaseUnits: netAssetOut,
    quantity,
    executionPriceUsdc,
    quantityNumber: Number(quantity),
    executionPriceUsdcNumber: Number(executionPriceUsdc),
    usdcHumanNumber: Number(usdcHuman),
  };
}

/**
 * Computes `usdcHuman / assetHuman` entirely in BigInt space and
 * formats the result as a 18-decimal string, preserving the full
 * precision the `numeric(38, 18)` column can hold.
 *
 *   priceHuman = usdcBase / 10^6 ÷ assetBase / 10^assetDecimals
 *              = usdcBase × 10^(assetDecimals − 6) ÷ assetBase
 *
 * Scaling up by 10^PRICE_FRACTION_DIGITS inside the numerator gives an
 * integer with the desired number of fractional digits, which we then
 * pass to `formatUnits` to get a canonical decimal string.
 */
function computePriceUsdc(args: {
  usdcBaseUnits: bigint;
  assetBaseUnits: bigint;
  assetDecimals: number;
}): string {
  const scale = BigInt(10) ** BigInt(args.assetDecimals + PRICE_FRACTION_DIGITS);
  const usdcScale = BigInt(10) ** BigInt(USDC_DECIMALS);
  const priceScaled =
    (args.usdcBaseUnits * scale) / (args.assetBaseUnits * usdcScale);
  return formatUnits(priceScaled, PRICE_FRACTION_DIGITS);
}

function safeGetAddress(value: string): Address | null {
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}
