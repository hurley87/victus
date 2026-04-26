import "server-only";

import { formatUnits, type Address, getAddress, parseUnits } from "viem";

import { readErc20Balance, readUsdcBalance } from "@/lib/chain/erc20";
import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import {
  getActiveSeason,
  getOrCreateSeasonEntry,
  type Season,
  type SeasonEntry,
} from "@/lib/seasons/service";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getAllowanceHolderQuote } from "@/lib/zerox/quote";

import type { TradeIntent } from "./intents";

/**
 * Policy validator for a parsed trade intent.
 *
 * When a `seasons.status='active'` row exists, Victus Games rules
 * replace the legacy per-wallet caps for buys: virtual cash + 5/season
 * tickets replace `max_trade_usdc`, `wallet_cap_usdc`, and
 * `max_trades_per_day`. The season token list also replaces
 * `asset_whitelist` for buy gating. When no season is active, the
 * legacy single-wallet contest rules apply.
 */

export type PolicyRejectionReason =
  | "needs_wallet_funding"
  | "asset_not_whitelisted"
  | "max_trades_per_day"
  | "max_trade_usdc"
  | "wallet_cap_usdc"
  | "insufficient_balance"
  | "no_active_season"
  | "no_season_entry"
  | "season_entry_inactive"
  | "season_max_trades_reached"
  | "season_token_not_approved"
  | "season_min_trade_size"
  | "season_insufficient_arena_balance"
  | "season_insufficient_position";

export type PolicyResult =
  | { ok: true; context: PolicyContext }
  | {
      ok: false;
      reason: PolicyRejectionReason;
      /** Present when `loadPolicy` ran — used for Roman policy-rejection copy with live caps. */
      policy?: PolicyContext["policy"];
    };

export type SeasonPolicyContext = {
  seasonId: string;
  seasonEntryId: string;
  tokenSymbol: string;
  tokenAddress: Address;
  tokenDecimals: number;
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
   * Sells only — exact asset base units computed from the season ledger
   * when a season is active, otherwise from on-chain balance.
   */
  sellAssetBaseUnits?: string;
  /** Populated when the trade is gated by an active Victus Games season. */
  season?: SeasonPolicyContext;
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

  const policy = await loadPolicy(params.walletId);
  const isBuy = params.intent.action === "buy";

  const activeSeason = await getActiveSeason();
  if (isBuy && !activeSeason) {
    return { ok: false, reason: "no_active_season", policy };
  }

  // Season-gated trades: virtual cash + 5/season tickets replace
  // per-wallet caps for buys, `season_tokens` replaces `asset_whitelist`,
  // and sells are sized from `season_positions` instead of wallet balance.
  if (activeSeason) {
    if (isBuy) {
      return validateSeasonBuy({ params, season: activeSeason, policy });
    }
    return validateSeasonSell({ params, season: activeSeason, policy });
  }

  const asset = await loadWhitelistedAsset(params.intent.symbol);
  if (!asset) return { ok: false, reason: "asset_not_whitelisted" };

  const tradesToday = await countCompletedSwapsTodayUtc(params.walletId);
  if (tradesToday >= policy.maxTradesPerDay) {
    return { ok: false, reason: "max_trades_per_day", policy };
  }

  if (isBuy && params.intent.amount_value > policy.maxTradeUsdc) {
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

async function validateSeasonBuy(args: {
  params: PolicyValidateParams;
  season: Season;
  policy: PolicyContext["policy"];
}): Promise<PolicyResult> {
  const { params, season, policy } = args;

  const gated = await loadSeasonTradeGate({ params, season, policy });
  if (!gated.ok) return gated;
  const { entry, token } = gated;

  const notional = params.intent.amount_value;
  const minTrade = Number(season.min_trade_size_usdc);
  if (notional + 1e-9 < minTrade) {
    return { ok: false, reason: "season_min_trade_size", policy };
  }

  const cashRemaining = Number(entry.cash_remaining_usdc);
  if (notional > cashRemaining + 1e-9) {
    return { ok: false, reason: "season_insufficient_arena_balance", policy };
  }

  return {
    ok: true,
    context: buildSeasonPolicyContext(params, policy, season, entry, token),
  };
}

async function validateSeasonSell(args: {
  params: PolicyValidateParams;
  season: Season;
  policy: PolicyContext["policy"];
}): Promise<PolicyResult> {
  const { params, season, policy } = args;

  const gated = await loadSeasonTradeGate({ params, season, policy });
  if (!gated.ok) return gated;
  const { entry, token } = gated;

  const position = await loadSeasonPosition({
    seasonEntryId: entry.id,
    symbol: token.token_symbol,
  });
  if (!position) {
    return { ok: false, reason: "season_insufficient_position", policy };
  }

  const positionAmount = Number(position.token_amount);
  const tokenAmount =
    (positionAmount * params.intent.amount_value) / 100;
  if (
    positionAmount <= 0 ||
    tokenAmount <= 0 ||
    tokenAmount > positionAmount + 1e-12
  ) {
    return { ok: false, reason: "season_insufficient_position", policy };
  }

  const sellAssetBaseUnits = parseUnits(
    tokenAmount.toFixed(token.decimals),
    token.decimals,
  ).toString();

  return {
    ok: true,
    context: buildSeasonPolicyContext(
      params,
      policy,
      season,
      entry,
      token,
      sellAssetBaseUnits,
    ),
  };
}

async function loadSeasonTradeGate(args: {
  params: PolicyValidateParams;
  season: Season;
  policy: PolicyContext["policy"];
}): Promise<
  | { ok: true; entry: SeasonEntry; token: SeasonTokenRow }
  | Extract<PolicyResult, { ok: false }>
> {
  const { params, season, policy } = args;
  const { entry } = await getOrCreateSeasonEntry({
    season,
    userId: params.userId,
    walletId: params.walletId,
  });
  if (entry.status !== "active") {
    return { ok: false, reason: "season_entry_inactive", policy };
  }
  if (entry.trades_used >= entry.max_trades) {
    return { ok: false, reason: "season_max_trades_reached", policy };
  }

  const token = await loadSeasonToken({
    seasonId: season.id,
    symbol: params.intent.symbol,
  });
  if (!token) {
    return { ok: false, reason: "season_token_not_approved", policy };
  }

  return { ok: true, entry, token };
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

type SeasonTokenRow = {
  token_symbol: string;
  token_address: string;
  decimals: number;
};

type SeasonPositionRow = {
  token_amount: number;
};

function buildSeasonPolicyContext(
  params: PolicyValidateParams,
  policy: PolicyContext["policy"],
  season: Season,
  entry: SeasonEntry,
  token: SeasonTokenRow,
  sellAssetBaseUnits?: string,
): PolicyContext {
  return {
    walletId: params.walletId,
    walletAddress: getAddress(params.walletAddress),
    privyWalletId: params.privyWalletId,
    assetAddress: getAddress(token.token_address),
    assetDecimals: token.decimals,
    sellAssetBaseUnits,
    season: {
      seasonId: season.id,
      seasonEntryId: entry.id,
      tokenSymbol: token.token_symbol,
      tokenAddress: getAddress(token.token_address),
      tokenDecimals: token.decimals,
    },
    policy,
  };
}

async function loadSeasonToken(params: {
  seasonId: string;
  symbol: string;
}): Promise<SeasonTokenRow | null> {
  const { data, error } = await supabaseAdmin
    .from("season_tokens")
    .select("token_symbol, token_address, decimals, is_active")
    .eq("season_id", params.seasonId)
    .eq("token_symbol", params.symbol)
    .maybeSingle();

  if (error) throw new Error(`season_tokens lookup failed: ${error.message}`);
  if (!data || !data.is_active) return null;
  return {
    token_symbol: data.token_symbol,
    token_address: data.token_address,
    decimals: data.decimals,
  };
}

async function loadSeasonPosition(params: {
  seasonEntryId: string;
  symbol: string;
}): Promise<SeasonPositionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("season_positions")
    .select("token_amount")
    .eq("season_entry_id", params.seasonEntryId)
    .eq("token_symbol", params.symbol)
    .maybeSingle();

  if (error) throw new Error(`season_positions lookup failed: ${error.message}`);
  return data ?? null;
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
