import "server-only";

import {
  readArenaBalance,
  type ArenaBalance,
  type TradableAsset,
} from "@/lib/chain/balances";
import { supabaseAdmin } from "@/lib/supabase/server";

import { utcCurrentMonthString, utcMonthBounds } from "@/lib/time/utc";

export type PortfolioHolding = {
  symbol: string;
  name: string;
  quantity: number;
  avg_cost_usdc: number;
  value_usdc: number;
};

export type SeasonPositionView = {
  symbol: string;
  token_amount: number;
  average_entry_price: number;
};

export type PortfolioTrade = {
  id: string;
  action: "buy" | "sell";
  symbol: string;
  quantity: number | null;
  notional_usdc: number | null;
  realized_pnl_usdc: number | null;
  confirmed_at: string | null;
  tx_hash: string | null;
};

export type PortfolioResult = {
  fid: number;
  username: string | null;
  display_name: string | null;
  /** Arena USDC cash plus at-cost position notionals (same basis as the holdings table). */
  total_portfolio_value_usdc: number;
  holdings: PortfolioHolding[];
  realized_pnl_month_usdc: number;
  realized_pnl_all_time_usdc: number;
  recent_trades: PortfolioTrade[];
  /** Current Victus Games positions (active season only). Empty when no season is open. */
  season_positions: SeasonPositionView[];
};

async function loadTradableAssets(): Promise<TradableAsset[]> {
  const { data, error } = await supabaseAdmin
    .from("asset_whitelist")
    .select("symbol, name, address, decimals")
    .eq("is_blocklisted", false)
    .eq("active", true)
    .eq("is_tradable", true)
    .order("symbol");

  if (error) {
    throw new Error(`portfolio: whitelist ${error.message}`);
  }

  return (data ?? []).map((r) => ({
    symbol: r.symbol,
    name: r.name,
    address: r.address,
    decimals: r.decimals,
  }));
}

async function loadSeasonPositionsForUser(
  userId: string,
): Promise<SeasonPositionView[]> {
  const { data: season, error: seasonErr } = await supabaseAdmin
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .maybeSingle();

  if (seasonErr) {
    throw new Error(`portfolio: active season ${seasonErr.message}`);
  }
  if (!season) return [];

  const { data: entry, error: entryErr } = await supabaseAdmin
    .from("season_entries")
    .select("id")
    .eq("season_id", season.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (entryErr) {
    throw new Error(`portfolio: season entry ${entryErr.message}`);
  }
  if (!entry) return [];

  const { data: positions, error: positionsErr } = await supabaseAdmin
    .from("season_positions")
    .select("token_symbol, token_amount, average_entry_price")
    .eq("season_entry_id", entry.id)
    .gt("token_amount", 0)
    .order("token_symbol");

  if (positionsErr) {
    throw new Error(`portfolio: season positions ${positionsErr.message}`);
  }

  return (positions ?? []).map((p) => ({
    symbol: p.token_symbol,
    token_amount: Number(p.token_amount),
    average_entry_price: Number(p.average_entry_price),
  }));
}

type TradeIntentEmbed = {
  action: string;
  wallet_id: string;
  asset_symbol?: string;
};

function tradeIntentJoin(ex: { trade_intents: unknown }): TradeIntentEmbed {
  return ex.trade_intents as TradeIntentEmbed;
}

export async function getPortfolioByFid(fid: number): Promise<PortfolioResult | null> {
  const { data: account, error: acctErr } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id, username, display_name")
    .eq("fid", fid)
    .maybeSingle();

  if (acctErr) {
    throw new Error(`portfolio: farcaster_accounts ${acctErr.message}`);
  }
  if (!account) {
    return null;
  }

  const userId = account.user_id;

  const [{ data: wallet }, tradableAssets] = await Promise.all([
    supabaseAdmin
      .from("arena_wallets")
      .select("id, wallet_address")
      .eq("user_id", userId)
      .maybeSingle(),
    loadTradableAssets(),
  ]);

  if (!wallet?.wallet_address) {
    return {
      fid,
      username: account.username,
      display_name: account.display_name,
      total_portfolio_value_usdc: 0,
      holdings: [],
      realized_pnl_month_usdc: 0,
      realized_pnl_all_time_usdc: 0,
      recent_trades: [],
      season_positions: [],
    };
  }

  const walletId = wallet.id;
  const walletAddress = wallet.wallet_address;

  const month = utcCurrentMonthString();
  const { startIso, endIso } = utcMonthBounds(month);

  const [
    { data: positions },
    liveBalance,
    { data: monthExecs, error: monthErr },
    { data: allSellExecs, error: allErr },
    { data: recentExecs, error: recentErr },
    seasonPositions,
  ] = await Promise.all([
    supabaseAdmin
      .from("positions")
      .select("asset_symbol, quantity, avg_cost_usdc")
      .eq("wallet_id", walletId),
    readArenaBalance(walletAddress, tradableAssets).catch(
      (): ArenaBalance => ({ usdc: 0, positions: [] }),
    ),
    supabaseAdmin
      .from("trade_executions")
      .select(
        "id, realized_pnl_usdc, trade_intent_id, trade_intents!inner(wallet_id, action)",
      )
      .eq("status", "confirmed")
      .eq("trade_intents.wallet_id", walletId)
      .gte("confirmed_at", startIso)
      .lt("confirmed_at", endIso),
    supabaseAdmin
      .from("trade_executions")
      .select(
        "realized_pnl_usdc, trade_intent_id, trade_intents!inner(wallet_id, action)",
      )
      .eq("status", "confirmed")
      .eq("trade_intents.wallet_id", walletId)
      .not("realized_pnl_usdc", "is", null),
    supabaseAdmin
      .from("trade_executions")
      .select(
        "id, quantity, notional_usdc, realized_pnl_usdc, confirmed_at, tx_hash, trade_intent_id, trade_intents!inner(wallet_id, action, asset_symbol)",
      )
      .eq("status", "confirmed")
      .eq("trade_intents.wallet_id", walletId)
      .order("confirmed_at", { ascending: false })
      .limit(10),
    loadSeasonPositionsForUser(userId),
  ]);

  if (monthErr) {
    throw new Error(`portfolio: month executions ${monthErr.message}`);
  }
  if (allErr) {
    throw new Error(`portfolio: all sells ${allErr.message}`);
  }
  if (recentErr) {
    throw new Error(`portfolio: recent ${recentErr.message}`);
  }

  const symbolMeta = new Map(tradableAssets.map((a) => [a.symbol, a]));

  const qtyOnChain = new Map(
    liveBalance.positions.map((p) => [p.symbol, p.quantity]),
  );

  const holdings: PortfolioHolding[] = (positions ?? [])
    .map((row) => {
      const symbol = row.asset_symbol;
      const meta = symbolMeta.get(symbol);
      const qtyChain = qtyOnChain.get(symbol) ?? 0;
      const qtyDb = Number(row.quantity);
      const qty = Math.max(qtyChain, qtyDb);
      if (qty <= 0) return null;
      const avgCost = Number(row.avg_cost_usdc);
      return {
        symbol,
        name: meta?.name ?? symbol,
        quantity: qty,
        avg_cost_usdc: avgCost,
        value_usdc: qty * avgCost,
      };
    })
    .filter((h): h is PortfolioHolding => h != null);

  let realizedMonth = 0;
  for (const ex of monthExecs ?? []) {
    const intent = tradeIntentJoin(ex);
    if (intent.wallet_id !== walletId) continue;
    if (intent.action !== "sell" || ex.realized_pnl_usdc == null) continue;
    realizedMonth += Number(ex.realized_pnl_usdc);
  }

  let realizedAll = 0;
  for (const ex of allSellExecs ?? []) {
    const intent = tradeIntentJoin(ex);
    if (intent.wallet_id !== walletId) continue;
    if (intent.action !== "sell") continue;
    realizedAll += Number(ex.realized_pnl_usdc);
  }

  const recent_trades: PortfolioTrade[] = (recentExecs ?? []).map((ex) => {
    const intent = tradeIntentJoin(ex);
    return {
      id: ex.id,
      action: intent.action as "buy" | "sell",
      symbol: intent.asset_symbol ?? "",
      quantity: ex.quantity != null ? Number(ex.quantity) : null,
      notional_usdc: ex.notional_usdc != null ? Number(ex.notional_usdc) : null,
      realized_pnl_usdc:
        ex.realized_pnl_usdc != null ? Number(ex.realized_pnl_usdc) : null,
      confirmed_at: ex.confirmed_at,
      tx_hash: ex.tx_hash,
    };
  });

  const holdingsValueSum = holdings.reduce((s, h) => s + h.value_usdc, 0);
  const total_portfolio_value_usdc = liveBalance.usdc + holdingsValueSum;

  return {
    fid,
    username: account.username,
    display_name: account.display_name,
    total_portfolio_value_usdc,
    holdings,
    realized_pnl_month_usdc: realizedMonth,
    realized_pnl_all_time_usdc: realizedAll,
    recent_trades,
    season_positions: seasonPositions,
  };
}
