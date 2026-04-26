import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUnits, parseUnits } from "viem";

import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import { env } from "@/lib/env";
import { redis } from "@/lib/redis";
import { getAllowanceHolderQuote } from "@/lib/zerox/quote";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import {
  getLeaderboardSeason,
  getSeasonTokens,
  serializeSeason,
  type Season,
  type SeasonSummary,
  type SeasonToken,
} from "./service";

type SupabaseAdmin = SupabaseClient<Database>;

export type SeasonLeaderboardEntry = {
  rank: number | null;
  season_entry_id: string;
  user_id: string;
  fid: number;
  username: string | null;
  portfolio_value_usdc: number;
  performance_return: number;
  cash_remaining_usdc: number;
  starting_balance_usdc: number;
  trades_used: number;
  has_qualifying_trade: boolean;
  status: string;
  is_commodus: boolean;
  performance_points: number;
  survival_bonus: number;
  commodus_bonus: number;
  final_score: number;
};

export type SeasonLeaderboardResult = {
  season: SeasonSummary | null;
  price_cache_ttl_seconds: number;
  entries: SeasonLeaderboardEntry[];
  ineligible: SeasonLeaderboardEntry[];
};

export type RecentActivityEntry = {
  execution_id: string;
  fid: number;
  username: string | null;
  action: "buy" | "sell";
  symbol: string;
  notional_usdc: number | null;
  realized_pnl_usdc: number | null;
  portfolio_value_usdc: number | null;
  confirmed_at: string;
};

export type RecentActivityResult = {
  active_today: number;
  recent: RecentActivityEntry[];
};

type SeasonEntryRow = Pick<
  Database["public"]["Tables"]["season_entries"]["Row"],
  | "id"
  | "user_id"
  | "wallet_id"
  | "cash_remaining_usdc"
  | "starting_balance_usdc"
  | "trades_used"
  | "has_qualifying_trade"
  | "status"
  | "created_at"
>;

type SeasonPositionRow = Pick<
  Database["public"]["Tables"]["season_positions"]["Row"],
  "season_entry_id" | "token_symbol" | "token_address" | "token_amount"
>;

type FarcasterAccountRow = Pick<
  Database["public"]["Tables"]["farcaster_accounts"]["Row"],
  "user_id" | "fid" | "username"
>;

type ArenaWalletRow = Pick<
  Database["public"]["Tables"]["arena_wallets"]["Row"],
  "id" | "wallet_address"
>;

type RecentSeasonTradeRow = Pick<
  Database["public"]["Tables"]["season_trades"]["Row"],
  | "trade_execution_id"
  | "season_entry_id"
  | "user_id"
  | "action"
  | "token_symbol"
  | "notional_usdc"
  | "created_at"
>;

type PriceCache = {
  get(key: string): Promise<string | number | null>;
  set(
    key: string,
    value: string,
    options: { ex: number },
  ): Promise<unknown>;
};

type QuotePriceProvider = (params: {
  token: SeasonToken;
  taker: string;
}) => Promise<number>;

export const SEASON_PRICE_CACHE_TTL_SECONDS = 60;

export async function getSeasonLeaderboard(
  client: SupabaseAdmin = supabaseAdmin,
): Promise<SeasonLeaderboardResult> {
  const season = await getLeaderboardSeason(client);
  if (!season) {
    return {
      season: null,
      price_cache_ttl_seconds: SEASON_PRICE_CACHE_TTL_SECONDS,
      entries: [],
      ineligible: [],
    };
  }

  const [{ data: entries, error: entriesErr }, { data: positions, error: positionsErr }] =
    await Promise.all([
      client
        .from("season_entries")
        .select(
          "id, user_id, wallet_id, cash_remaining_usdc, starting_balance_usdc, trades_used, has_qualifying_trade, status, created_at",
        )
        .eq("season_id", season.id),
      client
        .from("season_positions")
        .select("season_entry_id, token_symbol, token_address, token_amount")
        .eq("season_id", season.id),
    ]);

  if (entriesErr) {
    throw new Error(`season leaderboard: season_entries ${entriesErr.message}`);
  }
  if (positionsErr) {
    throw new Error(`season leaderboard: season_positions ${positionsErr.message}`);
  }

  const entryRows = (entries ?? []) as SeasonEntryRow[];
  const positionRows = (positions ?? []) as SeasonPositionRow[];
  const userIds = [...new Set(entryRows.map((entry) => entry.user_id))];
  const walletIds = [...new Set(entryRows.map((entry) => entry.wallet_id))];

  const [accounts, wallets, tokens] = await Promise.all([
    loadFarcasterAccounts(userIds, client),
    loadArenaWallets(walletIds, client),
    getSeasonTokens(season.id, client),
  ]);

  const prices =
    season.status === "settled"
      ? getSettledSeasonTokenPrices(tokens)
      : await getLiveSeasonTokenPrices({
          season,
          entries: entryRows,
          wallets,
          tokens,
        });

  return buildSeasonLeaderboard({
    season,
    entries: entryRows,
    positions: positionRows,
    accounts,
    prices,
    commodusFid: env.COMMODUS_FID ?? null,
  });
}

const RECENT_ACTIVITY_LIMIT = 5;
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getRecentSeasonActivity(
  client: SupabaseAdmin = supabaseAdmin,
): Promise<RecentActivityResult> {
  const season = await getLeaderboardSeason(client);
  if (!season) {
    return { active_today: 0, recent: [] };
  }

  const { data: tradeRows, error: tradesErr } = await client
    .from("season_trades")
    .select(
      "trade_execution_id, season_entry_id, user_id, action, token_symbol, notional_usdc, created_at",
    )
    .eq("season_id", season.id)
    .eq("status", "executed")
    .order("created_at", { ascending: false })
    .limit(200);

  if (tradesErr) {
    throw new Error(`season recent activity: season_trades ${tradesErr.message}`);
  }
  const rows = (tradeRows ?? []) as RecentSeasonTradeRow[];
  if (rows.length === 0) {
    return { active_today: 0, recent: [] };
  }

  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const executionIds = rows.map((row) => row.trade_execution_id);

  const [accounts, leaderboard, { data: execRows, error: execErr }] =
    await Promise.all([
      loadFarcasterAccounts(userIds, client),
      getSeasonLeaderboard(client),
      client
        .from("trade_executions")
        .select("id, realized_pnl_usdc, confirmed_at")
        .in("id", executionIds),
    ]);

  if (execErr) {
    throw new Error(`season recent activity: trade_executions ${execErr.message}`);
  }

  const accountByUser = new Map(accounts.map((account) => [account.user_id, account]));
  const execById = new Map((execRows ?? []).map((execution) => [execution.id, execution]));
  const entryById = new Map(
    [...leaderboard.entries, ...leaderboard.ineligible].map((entry) => [
      entry.season_entry_id,
      entry,
    ]),
  );

  const cutoffMs = Date.now() - ACTIVE_WINDOW_MS;
  const activeUserIds = new Set<string>();
  const recent: RecentActivityEntry[] = [];

  for (const row of rows) {
    const execution = execById.get(row.trade_execution_id);
    const confirmedAt = execution?.confirmed_at ?? row.created_at;
    const confirmedMs = new Date(confirmedAt).getTime();
    if (Number.isFinite(confirmedMs) && confirmedMs >= cutoffMs) {
      activeUserIds.add(row.user_id);
    }
    if (recent.length >= RECENT_ACTIVITY_LIMIT) continue;

    const account = accountByUser.get(row.user_id);
    if (!account) continue;
    const leaderboardEntry = entryById.get(row.season_entry_id);
    recent.push({
      execution_id: row.trade_execution_id,
      fid: account.fid,
      username: account.username,
      action: row.action as "buy" | "sell",
      symbol: row.token_symbol,
      notional_usdc:
        row.notional_usdc != null ? Number(row.notional_usdc) : null,
      realized_pnl_usdc:
        execution?.realized_pnl_usdc != null
          ? Number(execution.realized_pnl_usdc)
          : null,
      portfolio_value_usdc: leaderboardEntry?.portfolio_value_usdc ?? null,
      confirmed_at: confirmedAt,
    });
  }

  return { active_today: activeUserIds.size, recent };
}

export function buildSeasonLeaderboard(args: {
  season: Season;
  entries: SeasonEntryRow[];
  positions: SeasonPositionRow[];
  accounts: FarcasterAccountRow[];
  prices: Map<string, number>;
  commodusFid: number | null;
}): SeasonLeaderboardResult {
  const positionsByEntry = new Map<string, SeasonPositionRow[]>();
  for (const position of args.positions) {
    const existing = positionsByEntry.get(position.season_entry_id) ?? [];
    existing.push(position);
    positionsByEntry.set(position.season_entry_id, existing);
  }

  const accountByUser = new Map(
    args.accounts.map((account) => [account.user_id, account]),
  );

  const rows = args.entries.map((entry): SeasonLeaderboardEntry & { created_at: string } => {
    const positions = positionsByEntry.get(entry.id) ?? [];
    const holdingsValue = positions.reduce((sum, position) => {
      const price = args.prices.get(priceKey(position.token_address)) ?? 0;
      return sum + Number(position.token_amount) * price;
    }, 0);
    const starting = Number(entry.starting_balance_usdc);
    const portfolio = Number(entry.cash_remaining_usdc) + holdingsValue;
    const account = accountByUser.get(entry.user_id);
    const fid = account?.fid ?? 0;

    return {
      rank: null,
      season_entry_id: entry.id,
      user_id: entry.user_id,
      fid,
      username: account?.username ?? null,
      portfolio_value_usdc: portfolio,
      performance_return: starting > 0 ? (portfolio - starting) / starting : 0,
      cash_remaining_usdc: Number(entry.cash_remaining_usdc),
      starting_balance_usdc: starting,
      trades_used: entry.trades_used,
      has_qualifying_trade: entry.has_qualifying_trade,
      status: entry.status,
      is_commodus: args.commodusFid != null && fid === args.commodusFid,
      performance_points: 0,
      survival_bonus: 0,
      commodus_bonus: 0,
      final_score: 0,
      created_at: entry.created_at,
    };
  });

  const eligible = rows
    .filter((row) => row.has_qualifying_trade && row.status !== "disqualified")
    .sort(compareSeasonRows);
  const ineligible = rows
    .filter((row) => !row.has_qualifying_trade || row.status === "disqualified")
    .sort(compareSeasonRows);

  eligible.forEach((row, index) => {
    row.rank = index + 1;
  });
  if (args.season.status === "settled") {
    applyFinalScores(eligible);
  }

  return {
    season: serializeSeason(args.season),
    price_cache_ttl_seconds: SEASON_PRICE_CACHE_TTL_SECONDS,
    entries: eligible.map(stripSortField),
    ineligible: ineligible.map(stripSortField),
  };
}

export async function getCachedSeasonTokenPrices(args: {
  season: Pick<Season, "id">;
  tokens: SeasonToken[];
  taker: string;
  cache?: PriceCache;
  quotePrice?: QuotePriceProvider;
}): Promise<Map<string, number>> {
  const cache = args.cache ?? redis;
  const quotePrice = args.quotePrice ?? quoteSeasonTokenInUsdc;
  const prices = new Map<string, number>();

  await Promise.all(
    args.tokens.map(async (token) => {
      const key = `season:${args.season.id}:price:${priceKey(token.token_address)}`;
      const cached = await cache.get(key);
      if (cached != null && Number.isFinite(Number(cached))) {
        prices.set(priceKey(token.token_address), Number(cached));
        return;
      }

      const price = await quotePrice({ token, taker: args.taker });
      prices.set(priceKey(token.token_address), price);
      await cache.set(key, String(price), { ex: SEASON_PRICE_CACHE_TTL_SECONDS });
    }),
  );

  return prices;
}

function getSettledSeasonTokenPrices(tokens: SeasonToken[]): Map<string, number> {
  return new Map(
    tokens.map((token) => [
      priceKey(token.token_address),
      token.closing_price_usdc == null ? 0 : Number(token.closing_price_usdc),
    ]),
  );
}

async function getLiveSeasonTokenPrices(args: {
  season: Season;
  entries: SeasonEntryRow[];
  wallets: ArenaWalletRow[];
  tokens: SeasonToken[];
}): Promise<Map<string, number>> {
  const walletById = new Map(args.wallets.map((wallet) => [wallet.id, wallet]));
  const takerAddress =
    args.entries
      .map((entry) => walletById.get(entry.wallet_id)?.wallet_address)
      .find((address): address is string => Boolean(address)) ?? null;

  if (!takerAddress) return new Map<string, number>();
  return getCachedSeasonTokenPrices({
    season: args.season,
    tokens: args.tokens,
    taker: takerAddress,
  });
}

export function applyFinalScores(
  eligible: Array<SeasonLeaderboardEntry & { created_at?: string }>,
): void {
  const commodus = eligible.find((row) => row.is_commodus) ?? null;
  const commodusValue = commodus?.portfolio_value_usdc ?? null;

  eligible.forEach((row) => {
    const performancePoints = performancePointsForRank(row.rank);
    const survivalBonus = 5;
    const beatsCommodus =
      !row.is_commodus &&
      commodusValue != null &&
      row.portfolio_value_usdc > commodusValue;
    const commodusBonus = beatsCommodus ? 5 : 0;

    row.performance_points = performancePoints;
    row.survival_bonus = survivalBonus;
    row.commodus_bonus = commodusBonus;
    row.final_score = Math.min(
      100,
      performancePoints + survivalBonus + commodusBonus,
    );
  });
}

function performancePointsForRank(rank: number | null): number {
  if (rank == null) return 0;
  return Math.max(0, 100 - rank * 10);
}

async function quoteSeasonTokenInUsdc(args: {
  token: SeasonToken;
  taker: string;
}): Promise<number> {
  const quote = await getAllowanceHolderQuote({
    sellToken: args.token.token_address,
    buyToken: USDC_BASE_ADDRESS,
    sellAmount: parseUnits("1", args.token.decimals).toString(),
    taker: args.taker,
    slippageBps: 100,
  });
  return Number(formatUnits(BigInt(quote.buyAmount), USDC_DECIMALS));
}

async function loadFarcasterAccounts(
  userIds: string[],
  client: SupabaseAdmin,
): Promise<FarcasterAccountRow[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await client
    .from("farcaster_accounts")
    .select("user_id, fid, username")
    .in("user_id", userIds);

  if (error) {
    throw new Error(`season leaderboard: farcaster_accounts ${error.message}`);
  }
  return (data ?? []) as FarcasterAccountRow[];
}

async function loadArenaWallets(
  walletIds: string[],
  client: SupabaseAdmin,
): Promise<ArenaWalletRow[]> {
  if (walletIds.length === 0) return [];
  const { data, error } = await client
    .from("arena_wallets")
    .select("id, wallet_address")
    .in("id", walletIds);

  if (error) {
    throw new Error(`season leaderboard: arena_wallets ${error.message}`);
  }
  return (data ?? []) as ArenaWalletRow[];
}

function compareSeasonRows(
  a: SeasonLeaderboardEntry & { created_at: string },
  b: SeasonLeaderboardEntry & { created_at: string },
): number {
  if (b.portfolio_value_usdc !== a.portfolio_value_usdc) {
    return b.portfolio_value_usdc - a.portfolio_value_usdc;
  }
  if (a.trades_used !== b.trades_used) {
    return a.trades_used - b.trades_used;
  }
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function stripSortField(
  row: SeasonLeaderboardEntry & { created_at: string },
): SeasonLeaderboardEntry {
  const { created_at: _createdAt, ...entry } = row;
  return entry;
}

function priceKey(address: string): string {
  return address.toLowerCase();
}
