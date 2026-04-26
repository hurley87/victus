import "server-only";

import { formatUnits, parseUnits } from "viem";

import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import { getAllowanceHolderQuote } from "@/lib/zerox/quote";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Season, SeasonToken } from "./service";

type SupabaseAdmin = SupabaseClient<Database>;

export type SettlementSeasonEntry = Pick<
  Database["public"]["Tables"]["season_entries"]["Row"],
  | "id"
  | "cash_remaining_usdc"
  | "starting_balance_usdc"
  | "status"
>;

export type SettlementPosition = Pick<
  Database["public"]["Tables"]["season_positions"]["Row"],
  "season_entry_id" | "token_address" | "token_amount"
>;

export type SettlementStore = {
  loadSettlementSeason(): Promise<Season | null>;
  loadSeasonTokens(seasonId: string): Promise<SeasonToken[]>;
  loadQuoteTakerAddress(seasonId: string): Promise<string | null>;
  saveClosingPrice(tokenId: string, priceUsdc: number): Promise<void>;
  loadActiveEntries(seasonId: string): Promise<SettlementSeasonEntry[]>;
  loadPositions(seasonId: string): Promise<SettlementPosition[]>;
  updateEntrySettlement(
    entryId: string,
    values: {
      settled_portfolio_value_usdc: number;
      settled_return_pct: number;
      status: "settled";
    },
  ): Promise<void>;
  markSeasonSettled(seasonId: string, settledAt: string): Promise<void>;
};

export type SettlementQuoteProvider = (params: {
  token: SeasonToken;
  taker: string;
}) => Promise<number>;

export type SettleSeasonResult =
  | {
      ok: true;
      status: "too_early" | "already_settled";
      season_id: string;
      season_status: string;
      settled_entries: 0;
      priced_tokens: 0;
    }
  | {
      ok: true;
      status: "no_season";
      season_id: null;
      season_status: null;
      settled_entries: 0;
      priced_tokens: 0;
    }
  | {
      ok: true;
      status: "settled";
      season_id: string;
      season_status: "settled";
      settled_entries: number;
      priced_tokens: number;
    };

export async function settleSeason(args: {
  now?: Date;
  store?: SettlementStore;
  quotePrice?: SettlementQuoteProvider;
} = {}): Promise<SettleSeasonResult> {
  const now = args.now ?? new Date();
  const store = args.store ?? createSupabaseSettlementStore();
  const quotePrice = args.quotePrice ?? quoteSeasonTokenInUsdc;
  const season = await store.loadSettlementSeason();

  if (!season) {
    return {
      ok: true,
      status: "no_season",
      season_id: null,
      season_status: null,
      settled_entries: 0,
      priced_tokens: 0,
    };
  }

  if (season.status === "settled") {
    return {
      ok: true,
      status: "already_settled",
      season_id: season.id,
      season_status: season.status,
      settled_entries: 0,
      priced_tokens: 0,
    };
  }

  if (now.getTime() < new Date(season.ends_at).getTime()) {
    return {
      ok: true,
      status: "too_early",
      season_id: season.id,
      season_status: season.status,
      settled_entries: 0,
      priced_tokens: 0,
    };
  }

  const tokens = await store.loadSeasonTokens(season.id);
  const prices = new Map<string, number>();
  const missingPrices = tokens.filter(
    (token) => token.closing_price_usdc == null,
  );
  const taker =
    missingPrices.length > 0 ? await store.loadQuoteTakerAddress(season.id) : null;

  if (missingPrices.length > 0 && !taker) {
    throw new Error(
      "settle-season: no arena wallet address available for closing quotes",
    );
  }

  let pricedTokens = 0;
  for (const token of tokens) {
    const key = priceKey(token.token_address);
    if (token.closing_price_usdc != null) {
      prices.set(key, Number(token.closing_price_usdc));
      continue;
    }

    const price = await quotePrice({ token, taker: taker as string });
    await store.saveClosingPrice(token.id, price);
    prices.set(key, price);
    pricedTokens += 1;
  }

  const [entries, positions] = await Promise.all([
    store.loadActiveEntries(season.id),
    store.loadPositions(season.id),
  ]);
  const positionsByEntry = groupPositionsByEntry(positions);

  for (const entry of entries) {
    const portfolioValue = computeSettledPortfolioValue({
      entry,
      positions: positionsByEntry.get(entry.id) ?? [],
      prices,
    });
    const starting = Number(entry.starting_balance_usdc);
    await store.updateEntrySettlement(entry.id, {
      settled_portfolio_value_usdc: portfolioValue,
      settled_return_pct:
        starting > 0 ? (portfolioValue - starting) / starting : 0,
      status: "settled",
    });
  }

  await store.markSeasonSettled(season.id, now.toISOString());

  return {
    ok: true,
    status: "settled",
    season_id: season.id,
    season_status: "settled",
    settled_entries: entries.length,
    priced_tokens: pricedTokens,
  };
}

export function computeSettledPortfolioValue(args: {
  entry: Pick<SettlementSeasonEntry, "cash_remaining_usdc">;
  positions: SettlementPosition[];
  prices: Map<string, number>;
}): number {
  const holdingsValue = args.positions.reduce((sum, position) => {
    const price = args.prices.get(priceKey(position.token_address)) ?? 0;
    return sum + Number(position.token_amount) * price;
  }, 0);
  return Number(args.entry.cash_remaining_usdc) + holdingsValue;
}

function createSupabaseSettlementStore(
  client: SupabaseAdmin = supabaseAdmin,
): SettlementStore {
  return {
    async loadSettlementSeason() {
      const { data: active, error: activeErr } = await client
        .from("seasons")
        .select("*")
        .eq("status", "active")
        .maybeSingle();
      if (activeErr) {
        throw new Error(`settle-season: load active season ${activeErr.message}`);
      }
      if (active) return active;

      const { data: settled, error: settledErr } = await client
        .from("seasons")
        .select("*")
        .eq("status", "settled")
        .order("ends_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (settledErr) {
        throw new Error(`settle-season: load settled season ${settledErr.message}`);
      }
      return settled ?? null;
    },
    async loadSeasonTokens(seasonId) {
      const { data, error } = await client
        .from("season_tokens")
        .select("*")
        .eq("season_id", seasonId);
      if (error) {
        throw new Error(`settle-season: load season_tokens ${error.message}`);
      }
      return data ?? [];
    },
    async loadQuoteTakerAddress(seasonId) {
      const { data: entry, error: entryErr } = await client
        .from("season_entries")
        .select("wallet_id")
        .eq("season_id", seasonId)
        .limit(1)
        .maybeSingle();
      if (entryErr) {
        throw new Error(`settle-season: load quote taker ${entryErr.message}`);
      }
      if (!entry) return null;

      const { data: wallet, error: walletErr } = await client
        .from("arena_wallets")
        .select("wallet_address")
        .eq("id", entry.wallet_id)
        .maybeSingle();
      if (walletErr) {
        throw new Error(`settle-season: load taker wallet ${walletErr.message}`);
      }
      return wallet?.wallet_address ?? null;
    },
    async saveClosingPrice(tokenId, priceUsdc) {
      const { error } = await client
        .from("season_tokens")
        .update({ closing_price_usdc: priceUsdc })
        .eq("id", tokenId)
        .is("closing_price_usdc", null);
      if (error) {
        throw new Error(`settle-season: save closing price ${error.message}`);
      }
    },
    async loadActiveEntries(seasonId) {
      const { data, error } = await client
        .from("season_entries")
        .select("id, cash_remaining_usdc, starting_balance_usdc, status")
        .eq("season_id", seasonId)
        .eq("status", "active");
      if (error) {
        throw new Error(`settle-season: load entries ${error.message}`);
      }
      return data ?? [];
    },
    async loadPositions(seasonId) {
      const { data, error } = await client
        .from("season_positions")
        .select("season_entry_id, token_address, token_amount")
        .eq("season_id", seasonId);
      if (error) {
        throw new Error(`settle-season: load positions ${error.message}`);
      }
      return data ?? [];
    },
    async updateEntrySettlement(entryId, values) {
      const { error } = await client
        .from("season_entries")
        .update(values)
        .eq("id", entryId)
        .eq("status", "active");
      if (error) {
        throw new Error(`settle-season: update entry ${error.message}`);
      }
    },
    async markSeasonSettled(seasonId, settledAt) {
      const { error } = await client
        .from("seasons")
        .update({ status: "settled", settled_at: settledAt })
        .eq("id", seasonId)
        .eq("status", "active");
      if (error) {
        throw new Error(`settle-season: mark season settled ${error.message}`);
      }
    },
  };
}

function groupPositionsByEntry(
  positions: SettlementPosition[],
): Map<string, SettlementPosition[]> {
  const byEntry = new Map<string, SettlementPosition[]>();
  for (const position of positions) {
    const existing = byEntry.get(position.season_entry_id) ?? [];
    existing.push(position);
    byEntry.set(position.season_entry_id, existing);
  }
  return byEntry;
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

function priceKey(address: string): string {
  return address.toLowerCase();
}
