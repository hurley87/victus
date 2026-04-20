import "server-only";

import { getCurrentMonthLeaderboard } from "@/lib/leaderboard/service";
import { getArenaProfile } from "@/lib/arena/service";
import { getPortfolioByFid } from "@/lib/portfolio/service";
import { supabaseAdmin } from "@/lib/supabase/server";

export type StatusViewContext = {
  fid: number;
  /** Title line for the Snap header — gladiator name, @username, or fid fallback. */
  displayHandle: string;
  rank: number | null;
  points: number;
  portfolioUsdc: number;
  dailySlotsRemaining: number;
  /** Points held by rank 10, or the lowest rank in the month if fewer than 10 fighters. */
  topTenCutoffPoints: number;
};

function truncateLabel(raw: string, maxChars: number): string {
  const t = raw.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1)}…`;
}

/**
 * Shared read model for `@commodus status` Snap JSON and templated reply text.
 * Reuses {@link getPortfolioByFid}, {@link getCurrentMonthLeaderboard}, and
 * {@link getArenaProfile} — the same surfaces as the Mini App/API.
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

  const [lb, arena] = await Promise.all([
    getCurrentMonthLeaderboard(),
    getArenaProfile(account.user_id, fid),
  ]);

  const entries = lb.entries;
  const self = entries.find((e) => e.fid === fid);
  const rank = self?.rank ?? null;
  const points = self?.points ?? 0;

  let topTenCutoffPoints = 1;
  if (entries.length >= 10) {
    topTenCutoffPoints = Math.max(1, entries[9]?.points ?? 1);
  } else if (entries.length > 0) {
    topTenCutoffPoints = Math.max(1, entries[entries.length - 1]?.points ?? 1);
  }

  const handle =
    portfolio.gladiator_name?.trim() ||
    (portfolio.username ? `@${portfolio.username}` : `fid ${fid}`);

  return {
    fid,
    displayHandle: truncateLabel(handle, 100),
    rank,
    points,
    portfolioUsdc: portfolio.total_portfolio_value_usdc,
    dailySlotsRemaining: arena.daily_slots_remaining,
    topTenCutoffPoints,
  };
}
