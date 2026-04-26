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
  getActiveSeason,
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
};

export type SeasonLeaderboardResult = {
  season: SeasonSummary | null;
  price_cache_ttl_seconds: number;
  entries: SeasonLeaderboardEntry[];
  ineligible: SeasonLeaderboardEntry[];
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
  const season = await getActiveSeason(client);
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

  const walletById = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  const takerAddress =
    entryRows
      .map((entry) => walletById.get(entry.wallet_id)?.wallet_address)
      .find((address): address is string => Boolean(address)) ?? null;
  const prices = takerAddress
    ? await getCachedSeasonTokenPrices({
        season,
        tokens,
        taker: takerAddress,
      })
    : new Map<string, number>();

  return buildSeasonLeaderboard({
    season,
    entries: entryRows,
    positions: positionRows,
    accounts,
    prices,
    commodusFid: env.COMMODUS_FID ?? null,
  });
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
