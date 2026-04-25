import "server-only";

import { formatUnits, type Address, getAddress } from "viem";

import { readErc20Balance, readUsdcBalance } from "@/lib/chain/erc20";
import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getAllowanceHolderQuote } from "@/lib/zerox/quote";

import type { TradeIntent } from "./intents";

/**
 * Policy validator for a parsed trade intent.
 *
 * Checks run in a fixed order. First failure wins — the caller records
 * the rejection reason on `cast_commands.error_reason` and publishes
 * the matching outcome-reply template.
 *
 * Order (PRD § Execution Rules, issue #8 / #12):
 *   1. wallet_funded         — requires a funded arena wallet
 *   2. asset_not_whitelisted — symbol must be active + tradable + not blocklisted
 *   3. max_trades_per_day    — completed swaps since 00:00 UTC
 *   4. max_trade_usdc        — size cap (buys only)
 *   5. wallet_cap_usdc       — live USDC + mark-to-0x of on-chain holdings (buys only)
 *   6. insufficient_balance  — sells: live ERC-20 balance × percent rounds to zero
 *
 * Sell sizing uses **on-chain** balances (viem), never cached `positions`.
 *
 * The validator may call 0x for valuation — same availability as the
 * quote step (requires `ZEROX_API_KEY`).
 */

export type PolicyRejectionReason =
  | "needs_wallet_funding"
  | "asset_not_whitelisted"
  | "max_trades_per_day"
  | "max_trade_usdc"
  | "wallet_cap_usdc"
  | "insufficient_balance";

export type PolicyResult =
  | { ok: true; context: PolicyContext }
  | {
      ok: false;
      reason: PolicyRejectionReason;
      /** Present when `loadPolicy` ran — used for Roman policy-rejection copy with live caps. */
      policy?: PolicyContext["policy"];
    };

/**
 * Context collected during validation and reused downstream by the
 * fee, quote, and submit steps. Keeping it narrow avoids a second set
 * of queries in the workflow.
 */
export type PolicyContext = {
  walletId: string;
  walletAddress: Address;
  privyWalletId: string;
  assetAddress: Address;
  assetDecimals: number;
  /**
   * Sells only — exact asset base units computed from **on-chain** balance
   * × percent (integer 1–100), floored, used as the 0x `sellAmount`.
   */
  sellAssetBaseUnits?: string;
  policy: {
    maxTradeUsdc: number;
    maxTradesPerDay: number;
    walletCapUsdc: number;
    maxSlippageBps: number;
    maxPriceImpactBps: number;
    swapFeeBps: number;
    swapFeeMinUsdc: number;
  };
};

export type PolicyValidateParams = {
  userId: string;
  walletId: string;
  walletAddress: string;
  privyWalletId: string;
  intent: TradeIntent;
};

/** True when `symbol` is active, tradable, and not blocklisted in `asset_whitelist`. */
export async function isTradableCommandSymbol(symbol: string): Promise<boolean> {
  const row = await loadWhitelistedAsset(symbol);
  return row != null;
}

export async function validatePolicy(
  params: PolicyValidateParams,
): Promise<PolicyResult> {
  const fundingReason = await checkWalletFunded(params.walletId);
  if (fundingReason) return { ok: false, reason: fundingReason };

  const asset = await loadWhitelistedAsset(params.intent.symbol);
  if (!asset) return { ok: false, reason: "asset_not_whitelisted" };

  const policy = await loadPolicy(params.walletId);

  const tradesToday = await countCompletedSwapsTodayUtc(params.walletId);
  if (tradesToday >= policy.maxTradesPerDay) {
    return { ok: false, reason: "max_trades_per_day", policy };
  }

  const isBuy = params.intent.action === "buy";
  const notional = params.intent.amount_value;

  if (isBuy && notional > policy.maxTradeUsdc) {
    return { ok: false, reason: "max_trade_usdc", policy };
  }

  if (isBuy) {
    const wallet = getAddress(params.walletAddress);
    const live = await readUsdcBalance(wallet);
    const heldUsdc = await sumOnChainHoldingsUsdcViaZerox({
      walletAddress: wallet,
      slippageBps: policy.maxSlippageBps,
    });
    const exposure = live + heldUsdc;
    if (exposure > policy.walletCapUsdc) {
      return { ok: false, reason: "wallet_cap_usdc", policy };
    }
  }

  let sellAssetBaseUnits: string | undefined;
  if (!isBuy) {
    const wallet = getAddress(params.walletAddress);
    const token = getAddress(asset.address);
    let positionWei: bigint;
    try {
      positionWei = await readErc20Balance(token, wallet);
    } catch {
      return { ok: false, reason: "insufficient_balance", policy };
    }

    if (positionWei <= BigInt(0)) {
      return { ok: false, reason: "insufficient_balance", policy };
    }

    const sellWei =
      (positionWei * BigInt(params.intent.amount_value)) / BigInt(100);
    if (sellWei <= BigInt(0)) {
      return { ok: false, reason: "insufficient_balance", policy };
    }

    sellAssetBaseUnits = sellWei.toString();
  }

  return {
    ok: true,
    context: {
      walletId: params.walletId,
      walletAddress: getAddress(params.walletAddress),
      privyWalletId: params.privyWalletId,
      assetAddress: getAddress(asset.address),
      assetDecimals: asset.decimals,
      sellAssetBaseUnits,
      policy,
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function checkWalletFunded(
  walletId: string,
): Promise<PolicyRejectionReason | null> {
  const { data, error } = await supabaseAdmin
    .from("arena_wallets")
    .select("funded_at")
    .eq("id", walletId)
    .maybeSingle();

  if (error) throw new Error(`arena_wallets lookup failed: ${error.message}`);
  if (!data?.funded_at) return "needs_wallet_funding";
  return null;
}

type WhitelistedAsset = {
  symbol: string;
  address: string;
  decimals: number;
};

async function loadWhitelistedAsset(
  symbol: string,
): Promise<WhitelistedAsset | null> {
  const { data, error } = await supabaseAdmin
    .from("asset_whitelist")
    .select("symbol, address, decimals, is_tradable, is_blocklisted, active")
    .eq("symbol", symbol)
    .maybeSingle();

  if (error) throw new Error(`asset_whitelist lookup failed: ${error.message}`);
  if (!data) return null;
  if (!data.is_tradable || data.is_blocklisted || !data.active) return null;

  return {
    symbol: data.symbol,
    address: data.address,
    decimals: data.decimals,
  };
}

/**
 * Count trades whose `cast_commands` row reached `executed` today (UTC),
 * joined from `trade_intents`. Parse/policy rejections never get that far;
 * score-time failures leave the cast in `failed`, so they do not consume
 * the daily quota.
 */
async function countCompletedSwapsTodayUtc(walletId: string): Promise<number> {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabaseAdmin
    .from("trade_intents")
    .select("id, cast_commands!inner(status, updated_at)", {
      head: true,
      count: "exact",
    })
    .eq("wallet_id", walletId)
    .eq("cast_commands.status", "executed")
    .gte("cast_commands.updated_at", startOfDayUtc.toISOString());

  if (error) {
    console.error("policy.countCompletedSwapsTodayUtc", error);
    return 0;
  }

  return count ?? 0;
}

type PolicyRow = PolicyContext["policy"];

async function loadPolicy(walletId: string): Promise<PolicyRow> {
  const { data, error } = await supabaseAdmin
    .from("wallet_policies")
    .select(
      "max_trade_usdc, max_trades_per_day, wallet_cap_usdc, max_slippage_bps, max_price_impact_bps, swap_fee_bps, swap_fee_min_usdc",
    )
    .eq("wallet_id", walletId)
    .maybeSingle();

  if (error) throw new Error(`wallet_policies lookup failed: ${error.message}`);
  if (!data) throw new Error(`wallet_policies missing for wallet ${walletId}`);

  return {
    maxTradeUsdc: Number(data.max_trade_usdc),
    maxTradesPerDay: data.max_trades_per_day,
    walletCapUsdc: Number(data.wallet_cap_usdc),
    maxSlippageBps: data.max_slippage_bps,
    maxPriceImpactBps: data.max_price_impact_bps,
    swapFeeBps: data.swap_fee_bps,
    swapFeeMinUsdc: Number(data.swap_fee_min_usdc),
  };
}

async function loadTradableAssetRows(): Promise<
  { address: string; decimals: number }[]
> {
  const { data, error } = await supabaseAdmin
    .from("asset_whitelist")
    .select("address, decimals")
    .eq("is_tradable", true)
    .eq("active", true)
    .eq("is_blocklisted", false);

  if (error) {
    throw new Error(`asset_whitelist tradable load failed: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Marks each non-USDC tradable token holding to USDC via a fresh 0x quote
 * (same semantics as a spot valuation at policy time).
 */
async function sumOnChainHoldingsUsdcViaZerox(params: {
  walletAddress: Address;
  slippageBps: number;
}): Promise<number> {
  const rows = await loadTradableAssetRows();
  let sum = 0;

  for (const row of rows) {
    const token = getAddress(row.address);
    if (token === USDC_BASE_ADDRESS) continue;

    const bal = await readErc20Balance(token, params.walletAddress);
    if (bal <= BigInt(0)) continue;

    const quote = await getAllowanceHolderQuote({
      sellToken: token,
      buyToken: USDC_BASE_ADDRESS,
      sellAmount: bal.toString(),
      taker: params.walletAddress,
      slippageBps: params.slippageBps,
    });

    if (!quote.liquidityAvailable) continue;

    sum += Number(formatUnits(BigInt(quote.buyAmount), USDC_DECIMALS));
  }

  return sum;
}
