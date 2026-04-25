import "server-only";

import { getAddress, parseUnits } from "viem";

import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import {
  readArenaBalance,
  type TradableAsset,
} from "@/lib/chain/balances";
import { computeSwapFeeUsdc } from "@/lib/execution/fees";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  getAllowanceHolderQuote,
  ZeroxNotConfiguredError,
  type AllowanceHolderQuote,
} from "@/lib/zerox/quote";

import { V1_BUY_STATED_USDC, V1_SELL_PERCENT } from "./sizing";
import type { CommodusPlayer } from "./types";
import type {
  CommodusMarketSnapshot,
  PolicySnapshot,
  TokenQuoteSnapshot,
} from "./market-snapshot";

export type {
  CommodusMarketSnapshot,
  PolicySnapshot,
  PositionSnapshot,
  TokenQuoteSnapshot,
  TradableAssetRow,
} from "./market-snapshot";

export { estimateExposureConcentration } from "./market-snapshot";

export async function buildCommodusMarketSnapshot(
  player: CommodusPlayer,
): Promise<CommodusMarketSnapshot> {
  const policy = await loadPolicySnapshot(player.walletId);
  const tradable = await loadTradableAssets();
  const [arenaBal, lastTrades, buyQuotes, sellQuotes] = await Promise.all([
    readArenaBalance(player.walletAddress, tradable).catch((): { usdc: number; positions: { symbol: string; quantity: number }[] } => ({
      usdc: 0,
      positions: [],
    })),
    loadLastConfirmedTradeTimeBySymbol(player.walletId),
    prefetchBuyQuotes(player.walletAddress, tradable, policy),
    prefetchSellQuotes(player.walletAddress, tradable, policy),
  ]);

  const positionSymbols = new Set(
    (arenaBal.positions ?? [])
      .filter((p) => p.quantity > 0)
      .map((p) => p.symbol),
  );

  return {
    policy,
    tradable,
    usdcCash: arenaBal.usdc,
    positions: (arenaBal.positions ?? [])
      .filter((p) => p.quantity > 0)
      .map((p) => ({ symbol: p.symbol, quantity: p.quantity })),
    lastTradeAtBySymbol: lastTrades,
    buyQuotesBySymbol: buyQuotes,
    sellQuoteBySymbol: sellQuotes,
    positionSymbols,
  };
}

async function loadPolicySnapshot(walletId: string): Promise<PolicySnapshot> {
  const { data, error } = await supabaseAdmin
    .from("wallet_policies")
    .select(
      "max_trade_usdc, max_trades_per_day, wallet_cap_usdc, max_slippage_bps, max_price_impact_bps, swap_fee_bps, swap_fee_min_usdc",
    )
    .eq("wallet_id", walletId)
    .maybeSingle();

  if (error) throw new Error(`commodus snapshot: wallet_policies ${error.message}`);
  if (!data) throw new Error(`commodus snapshot: wallet_policies missing for ${walletId}`);

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

async function loadTradableAssets(): Promise<TradableAsset[]> {
  const { data, error } = await supabaseAdmin
    .from("asset_whitelist")
    .select("symbol, name, address, decimals")
    .eq("is_blocklisted", false)
    .eq("active", true)
    .eq("is_tradable", true)
    .order("symbol");

  if (error) {
    throw new Error(`commodus snapshot: whitelist ${error.message}`);
  }

  return (data ?? []).map((r) => ({
    symbol: r.symbol,
    name: r.name,
    address: r.address,
    decimals: r.decimals,
  }));
}

async function loadLastConfirmedTradeTimeBySymbol(
  walletId: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin
    .from("trade_executions")
    .select("confirmed_at, trade_intents!inner(wallet_id, asset_symbol)")
    .eq("status", "confirmed")
    .eq("trade_intents.wallet_id", walletId)
    .order("confirmed_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`commodus snapshot: last trades ${error.message}`);
  }

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const tw = row.trade_intents as { asset_symbol?: string } | null;
    const sym = tw?.asset_symbol;
    if (!sym || !row.confirmed_at) continue;
    const ts = new Date(row.confirmed_at).getTime();
    if (!map.has(sym)) {
      map.set(sym, ts);
    }
  }
  return map;
}

function slippageProxyFromQuote(q: AllowanceHolderQuote): number {
  if (!q.liquidityAvailable) return 1;
  const p = q.price ? Number.parseFloat(q.price) : 0;
  const g = q.guaranteedPrice ? Number.parseFloat(q.guaranteedPrice) : 0;
  if (p > 0 && g > 0) {
    return Math.min(1, Math.abs(g - p) / p);
  }
  return 0;
}

async function prefetchBuyQuotes(
  taker: string,
  tradable: TradableAsset[],
  policy: PolicySnapshot,
): Promise<Map<string, TokenQuoteSnapshot>> {
  const out = new Map<string, TokenQuoteSnapshot>();
  const fee = computeSwapFeeUsdc({
    notionalUsdc: V1_BUY_STATED_USDC,
    swapFeeBps: policy.swapFeeBps,
    swapFeeMinUsdc: policy.swapFeeMinUsdc,
  });
  const net = Math.max(V1_BUY_STATED_USDC - fee, 0);
  if (net <= 0) return out;

  const sellWei = parseUnits(net.toFixed(USDC_DECIMALS), USDC_DECIMALS);
  const t = getAddress(taker);

  const buyAssets = tradable.filter(
    (a) => getAddress(a.address) !== getAddress(USDC_BASE_ADDRESS),
  );

  const buyResults = await Promise.all(
    buyAssets.map(async (asset) => {
      const buyToken = getAddress(asset.address);
      try {
        const q = await getAllowanceHolderQuote({
          sellToken: USDC_BASE_ADDRESS,
          buyToken,
          sellAmount: sellWei.toString(),
          taker: t,
          slippageBps: policy.maxSlippageBps,
        });
        return {
          symbol: asset.symbol,
          snap: {
            symbol: asset.symbol,
            address: asset.address,
            decimals: asset.decimals,
            liquidityAvailable: q.liquidityAvailable,
            slippageProxy: slippageProxyFromQuote(q),
          } satisfies TokenQuoteSnapshot,
        };
      } catch (err) {
        const snap: TokenQuoteSnapshot = {
          symbol: asset.symbol,
          address: asset.address,
          decimals: asset.decimals,
          liquidityAvailable: err instanceof ZeroxNotConfiguredError ? false : false,
          slippageProxy: 1,
        };
        return { symbol: asset.symbol, snap };
      }
    }),
  );

  for (const r of buyResults) {
    out.set(r.symbol, r.snap);
  }

  return out;
}

async function prefetchSellQuotes(
  taker: string,
  tradable: TradableAsset[],
  policy: PolicySnapshot,
): Promise<Map<string, TokenQuoteSnapshot>> {
  const out = new Map<string, TokenQuoteSnapshot>();
  const t = getAddress(taker);
  const arena = await readArenaBalance(taker, tradable).catch(
    (): { usdc: number; positions: { symbol: string; quantity: number }[] } => ({
      usdc: 0,
      positions: [],
    }),
  );

  for (const pos of arena.positions ?? []) {
    if (pos.quantity <= 0) continue;
    const meta = tradable.find((a) => a.symbol === pos.symbol);
    if (!meta) continue;

    const sellWei = parseUnits(
      ((pos.quantity * V1_SELL_PERCENT) / 100).toFixed(meta.decimals),
      meta.decimals,
    );
    if (sellWei <= BigInt(0)) continue;

    try {
      const q = await getAllowanceHolderQuote({
        sellToken: getAddress(meta.address),
        buyToken: USDC_BASE_ADDRESS,
        sellAmount: sellWei.toString(),
        taker: t,
        slippageBps: policy.maxSlippageBps,
      });
      out.set(meta.symbol, {
        symbol: meta.symbol,
        address: meta.address,
        decimals: meta.decimals,
        liquidityAvailable: q.liquidityAvailable,
        slippageProxy: slippageProxyFromQuote(q),
      });
    } catch (err) {
      if (err instanceof ZeroxNotConfiguredError) {
        out.set(meta.symbol, {
          symbol: meta.symbol,
          address: meta.address,
          decimals: meta.decimals,
          liquidityAvailable: false,
          slippageProxy: 1,
        });
        continue;
      }
      out.set(meta.symbol, {
        symbol: meta.symbol,
        address: meta.address,
        decimals: meta.decimals,
        liquidityAvailable: false,
        slippageProxy: 1,
      });
    }
  }

  return out;
}
