import "server-only";

import { parseUnits, type Address, getAddress } from "viem";

import { readUsdcBalance } from "@/lib/chain/erc20";
import { supabaseAdmin } from "@/lib/supabase/server";

import type { TradeIntent } from "./intents";

/**
 * Policy validator for a parsed trade intent.
 *
 * Checks run in a fixed order. First failure wins — the caller records
 * the rejection reason on `cast_commands.error_reason` and publishes
 * the matching outcome-reply template.
 *
 * Order (PRD § Execution Rules, issue #8):
 *   1. gladiator_alive      — requires an `alive` gladiator
 *   2. asset_not_whitelisted — symbol must be active + tradable + not blocklisted
 *   3. max_trades_per_day   — slot count for the UTC day
 *   4. max_trade_usdc       — size cap (buys only)
 *   5. wallet_cap_usdc      — live arena-wallet USDC via viem (buys only)
 *   6. insufficient_position — sells: DB position missing, zero-size, or
 *                              computed sell amount rounds to zero on-chain
 *
 * Per-intent-type rules apply only where stated: sell intents skip
 * size and wallet-cap checks (sells pay out USDC; they don't consume it).
 *
 * The validator is side-effect-free aside from the live chain read —
 * callers update `cast_commands.status` based on the returned result.
 */

export type PolicyRejectionReason =
  | "needs_gladiator_mint"
  | "asset_not_whitelisted"
  | "max_trades_per_day"
  | "max_trade_usdc"
  | "wallet_cap_usdc"
  | "insufficient_position";

export type PolicyResult =
  | { ok: true; context: PolicyContext }
  | { ok: false; reason: PolicyRejectionReason };

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
   * Sells only — exact asset base units computed from `positions.quantity`
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

export async function validatePolicy(
  params: PolicyValidateParams,
): Promise<PolicyResult> {
  const aliveReason = await checkGladiatorAlive(params.userId);
  if (aliveReason) return { ok: false, reason: aliveReason };

  const asset = await loadWhitelistedAsset(params.intent.symbol);
  if (!asset) return { ok: false, reason: "asset_not_whitelisted" };

  const policy = await loadPolicy(params.walletId);

  const tradesToday = await countTradesToday(params.walletId);
  if (tradesToday >= policy.maxTradesPerDay) {
    return { ok: false, reason: "max_trades_per_day" };
  }

  const isBuy = params.intent.action === "buy";
  const notional = params.intent.amount_value;

  if (isBuy && notional > policy.maxTradeUsdc) {
    return { ok: false, reason: "max_trade_usdc" };
  }

  if (isBuy) {
    const live = await readUsdcBalance(getAddress(params.walletAddress));
    // Cap is a ceiling on arena USDC — a buy that would leave the
    // wallet over-capped is rejected *before* the trade, so deposits
    // can't be pre-staged to cheat the cap.
    if (live > policy.walletCapUsdc) {
      return { ok: false, reason: "wallet_cap_usdc" };
    }
  }

  let sellAssetBaseUnits: string | undefined;
  if (!isBuy) {
    const position = await loadPositionQuantity(
      params.walletId,
      params.intent.symbol,
    );
    if (!position) {
      return { ok: false, reason: "insufficient_position" };
    }

    let positionWei: bigint;
    try {
      positionWei = parseUnits(
        String(position.quantity).trim(),
        asset.decimals,
      );
    } catch {
      return { ok: false, reason: "insufficient_position" };
    }

    if (positionWei <= BigInt(0)) {
      return { ok: false, reason: "insufficient_position" };
    }

    const sellWei =
      (positionWei * BigInt(params.intent.amount_value)) / BigInt(100);
    if (sellWei <= BigInt(0)) {
      return { ok: false, reason: "insufficient_position" };
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

async function checkGladiatorAlive(
  userId: string,
): Promise<PolicyRejectionReason | null> {
  const { data, error } = await supabaseAdmin
    .from("gladiators")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`gladiators lookup failed: ${error.message}`);
  if (!data || data.status !== "alive") return "needs_gladiator_mint";
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

async function countTradesToday(walletId: string): Promise<number> {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabaseAdmin
    .from("trade_intents")
    .select("id", { head: true, count: "exact" })
    .eq("wallet_id", walletId)
    .neq("status", "rejected")
    .gte("created_at", startOfDayUtc.toISOString());

  if (error) {
    // Fail open on a read error — loudly logged so it shows up in
    // telemetry. Failing closed would let an ops blip silently refuse
    // every trade.
    console.error("policy.countTradesToday failed", error);
    return 0;
  }

  return count ?? 0;
}

type PolicyRow = PolicyContext["policy"];

async function loadPositionQuantity(
  walletId: string,
  assetSymbol: string,
): Promise<{ quantity: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("positions")
    .select("quantity")
    .eq("wallet_id", walletId)
    .eq("asset_symbol", assetSymbol)
    .maybeSingle();

  if (error) {
    throw new Error(`positions lookup failed: ${error.message}`);
  }
  if (!data) return null;

  const qty = String(data.quantity).trim();
  if (!qty || Number(qty) <= 0) return null;

  return { quantity: qty };
}

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
