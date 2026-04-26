import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/lib/arena/session";
import { readArenaBalance } from "@/lib/chain/balances";
import {
  getActiveSeason,
  getOrCreateSeasonEntry,
  getSeasonTokens,
  hasSufficientEntryFunding,
  serializeSeason,
  type SeasonEntry,
  type SeasonSummary,
  type SeasonToken,
} from "@/lib/seasons/service";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export type SeasonEnterResponse = {
  season: SeasonSummary;
  entry: SeasonEntry;
  tokens: SeasonToken[];
  created: boolean;
};

export async function POST(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  try {
    const [season, walletQuery] = await Promise.all([
      getActiveSeason(),
      supabaseAdmin
        .from("arena_wallets")
        .select("id, wallet_address, status")
        .eq("user_id", session.userId)
        .maybeSingle(),
    ]);

    if (!season) {
      return NextResponse.json(
        { error: "no_active_season" },
        { status: 409 },
      );
    }

    if (walletQuery.error) {
      throw new Error(`arena_wallets: ${walletQuery.error.message}`);
    }
    const wallet = walletQuery.data;
    if (!wallet?.wallet_address || wallet.status !== "active") {
      return NextResponse.json(
        { error: "needs_wallet_funding" },
        { status: 409 },
      );
    }

    const startingBalance = Number(season.starting_balance_usdc);
    const balance = await readArenaBalance(wallet.wallet_address, []);
    if (!hasSufficientEntryFunding(balance.usdc, startingBalance)) {
      return NextResponse.json(
        { error: "insufficient_funding" },
        { status: 409 },
      );
    }

    const [{ entry, created }, tokens] = await Promise.all([
      getOrCreateSeasonEntry({
        season,
        userId: session.userId,
        walletId: wallet.id,
      }),
      getSeasonTokens(season.id),
    ]);

    if (created) {
      console.info("season.entry.created", {
        user_id: session.userId,
        season_id: season.id,
        entry_id: entry.id,
      });
    }

    const body: SeasonEnterResponse = {
      season: serializeSeason(season),
      entry,
      tokens,
      created,
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error("season.enter.failed", err);
    return NextResponse.json(
      { error: "season_enter_failed" },
      { status: 500 },
    );
  }
}
