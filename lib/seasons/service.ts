import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type SupabaseAdmin = SupabaseClient<Database>;

export type Season = Database["public"]["Tables"]["seasons"]["Row"];
export type SeasonToken = Database["public"]["Tables"]["season_tokens"]["Row"];
export type SeasonEntry =
  Database["public"]["Tables"]["season_entries"]["Row"];

export type SeasonSummary = {
  id: string;
  name: string;
  starting_balance_usdc: number;
  max_trades: number;
  min_trade_size_usdc: number;
  starts_at: string;
  ends_at: string;
};

export function serializeSeason(season: Season): SeasonSummary {
  return {
    id: season.id,
    name: season.name,
    starting_balance_usdc: Number(season.starting_balance_usdc),
    max_trades: season.max_trades,
    min_trade_size_usdc: Number(season.min_trade_size_usdc),
    starts_at: season.starts_at,
    ends_at: season.ends_at,
  };
}

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

export async function getActiveSeason(
  client: SupabaseAdmin = supabaseAdmin,
): Promise<Season | null> {
  const { data, error } = await client
    .from("seasons")
    .select("*")
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(`seasons: getActiveSeason ${error.message}`);
  }
  return data ?? null;
}

export async function getSeasonTokens(
  seasonId: string,
  client: SupabaseAdmin = supabaseAdmin,
): Promise<SeasonToken[]> {
  const { data, error } = await client
    .from("season_tokens")
    .select("*")
    .eq("season_id", seasonId)
    .eq("is_active", true)
    .order("token_symbol");

  if (error) {
    throw new Error(`seasons: getSeasonTokens ${error.message}`);
  }
  return data ?? [];
}

export async function getSeasonEntry(
  params: { seasonId: string; userId: string },
  client: SupabaseAdmin = supabaseAdmin,
): Promise<SeasonEntry | null> {
  const { data, error } = await client
    .from("season_entries")
    .select("*")
    .eq("season_id", params.seasonId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) {
    throw new Error(`seasons: getSeasonEntry ${error.message}`);
  }
  return data ?? null;
}

/**
 * Idempotent: returns the existing entry if one already exists for this
 * (season, user). Otherwise inserts a fresh entry seeded from the season's
 * starting balance / max-trades. Concurrent first-time calls race on the
 * (season_id, user_id) unique index — on conflict we re-read the row so
 * both callers see the same canonical entry.
 */
export async function getOrCreateSeasonEntry(
  params: {
    season: Season;
    userId: string;
    walletId: string;
  },
  client: SupabaseAdmin = supabaseAdmin,
): Promise<{ entry: SeasonEntry; created: boolean }> {
  const existing = await getSeasonEntry(
    { seasonId: params.season.id, userId: params.userId },
    client,
  );
  if (existing) {
    return { entry: existing, created: false };
  }

  const startingBalance = Number(params.season.starting_balance_usdc);
  const maxTrades = params.season.max_trades;

  const { data: inserted, error } = await client
    .from("season_entries")
    .insert({
      season_id: params.season.id,
      user_id: params.userId,
      wallet_id: params.walletId,
      starting_balance_usdc: startingBalance,
      cash_remaining_usdc: startingBalance,
      trades_used: 0,
      max_trades: maxTrades,
      has_qualifying_trade: false,
      status: "active",
    })
    .select()
    .single();

  if (error) {
    // Concurrent insert — re-read the winner's row.
    if (error.code === "23505") {
      const winner = await getSeasonEntry(
        { seasonId: params.season.id, userId: params.userId },
        client,
      );
      if (winner) {
        return { entry: winner, created: false };
      }
    }
    throw new Error(`seasons: getOrCreateSeasonEntry ${error.message}`);
  }

  return { entry: inserted, created: true };
}
