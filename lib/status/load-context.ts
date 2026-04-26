import "server-only";

import { getArenaProfile } from "@/lib/arena/service";
import { getPortfolioByFid } from "@/lib/portfolio/service";
import { getSeasonLeaderboard } from "@/lib/seasons/leaderboard";
import { supabaseAdmin } from "@/lib/supabase/server";

export type StatusViewContext = {
  fid: number;
  /** Title line for the Snap header — @username, display name, or fid fallback. */
  displayHandle: string;
  rank: number | null;
  arenaValueUsdc: number;
  performanceReturn: number;
  dailySlotsRemaining: number;
};

function truncateLabel(raw: string, maxChars: number): string {
  const t = raw.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1)}…`;
}

/**
 * Shared read model for `@commodus status` Snap JSON and templated reply text.
 * Reuses the season leaderboard and arena profile — the same surfaces as the
 * Mini App/API.
 */
export async function loadStatusViewContext(
  fid: number,
): Promise<StatusViewContext | null> {
  const { data: account, error: acctErr } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id")
    .eq("fid", fid)
    .maybeSingle();

  if (acctErr) {
    throw new Error(`status context: farcaster_accounts ${acctErr.message}`);
  }
  if (!account?.user_id) {
    return null;
  }

  const portfolio = await getPortfolioByFid(fid);
  if (!portfolio) {
    return null;
  }

  const [leaderboard, arena] = await Promise.all([
    getSeasonLeaderboard(),
    getArenaProfile(account.user_id, fid),
  ]);

  const entries = [...leaderboard.entries, ...leaderboard.ineligible];
  const self = entries.find((e) => e.fid === fid);
  const rank = self?.rank ?? null;

  const handle =
    (portfolio.username ? `@${portfolio.username}` : null) ||
    portfolio.display_name?.trim() ||
    `fid ${fid}`;

  return {
    fid,
    displayHandle: truncateLabel(handle, 100),
    rank,
    arenaValueUsdc: self?.portfolio_value_usdc ?? 0,
    performanceReturn: self?.performance_return ?? 0,
    dailySlotsRemaining: arena.daily_slots_remaining,
  };
}
