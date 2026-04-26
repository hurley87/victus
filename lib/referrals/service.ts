import "server-only";

import { referralDeepLink } from "@/lib/commodus/deep-links";
import { getLeaderboardSeason } from "@/lib/seasons/service";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ReferralSummary } from "./types";

export { type ReferralRecentUser, type ReferralSummary } from "./types";
export const REFERRAL_BONUS_POINTS = 5;

type ReferralRow = {
  referrer_user_id: string;
  referred_user_id: string;
  referred_fid: number;
  referred_at: string;
  first_funded_at: string | null;
  awarded_at: string | null;
  award_season_id: string | null;
  season_bonus_points: number;
};

export async function recordReferralSignup(params: {
  referrerFid: number | null | undefined;
  referredFid: number;
  referredUserId: string;
}): Promise<void> {
  const referrerFid = normalizeFid(params.referrerFid);
  if (referrerFid == null || referrerFid === params.referredFid) {
    return;
  }

  const { data: referrer, error: referrerErr } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id")
    .eq("fid", referrerFid)
    .maybeSingle();

  if (referrerErr) {
    throw new Error(`referrals: failed to load referrer: ${referrerErr.message}`);
  }

  if (!referrer?.user_id || referrer.user_id === params.referredUserId) {
    return;
  }

  const { error } = await supabaseAdmin.from("referrals").insert({
    referrer_user_id: referrer.user_id,
    referred_user_id: params.referredUserId,
    referrer_fid: referrerFid,
    referred_fid: params.referredFid,
  });

  if (error && error.code !== "23505") {
    throw new Error(`referrals: failed to record signup: ${error.message}`);
  }
}

export async function awardReferralForFirstFunding(params: {
  referredUserId: string;
  fundedAt: string;
}): Promise<void> {
  const season = await getLeaderboardSeason();
  const { error } = await supabaseAdmin
    .from("referrals")
    .update({
      first_funded_at: params.fundedAt,
      awarded_at: params.fundedAt,
      award_season_id: season?.id ?? null,
      season_bonus_points: season ? REFERRAL_BONUS_POINTS : 0,
    })
    .eq("referred_user_id", params.referredUserId)
    .is("awarded_at", null);

  if (error) {
    throw new Error(`referrals: failed to award first funding: ${error.message}`);
  }
}

export async function getReferralSummary(params: {
  userId: string;
  fid: number;
}): Promise<ReferralSummary> {
  const season = await getLeaderboardSeason();
  const { data, error } = await supabaseAdmin
    .from("referrals")
    .select(
      "referrer_user_id, referred_user_id, referred_fid, referred_at, first_funded_at, awarded_at, award_season_id, season_bonus_points",
    )
    .eq("referrer_user_id", params.userId)
    .order("referred_at", { ascending: false });

  if (error) {
    throw new Error(`referrals: failed to load summary: ${error.message}`);
  }

  const rows = (data ?? []) as ReferralRow[];
  const recentRows = rows.slice(0, 5);
  const referredFids = recentRows.map((row) => row.referred_fid);
  const usernameByFid = await loadUsernamesByFid(referredFids);

  return {
    referralUrl: referralDeepLink(params.fid),
    signups: rows.length,
    funded: rows.filter((row) => row.first_funded_at != null).length,
    seasonBonusPoints: rows
      .filter(
        (row) =>
          row.award_season_id === season?.id && row.awarded_at != null,
      )
      .reduce((sum, row) => sum + Number(row.season_bonus_points ?? 0), 0),
    bonusPointsPerFunding: REFERRAL_BONUS_POINTS,
    recent: recentRows.map((row) => ({
      fid: row.referred_fid,
      username: usernameByFid.get(row.referred_fid) ?? null,
      referredAt: row.referred_at,
      firstFundedAt: row.first_funded_at,
      awardedAt: row.awarded_at,
    })),
  };
}

function normalizeFid(fid: number | null | undefined): number | null {
  if (fid == null || !Number.isFinite(fid) || !Number.isInteger(fid) || fid <= 0) {
    return null;
  }
  return fid;
}

async function loadUsernamesByFid(fids: number[]): Promise<Map<number, string | null>> {
  const unique = [...new Set(fids)].filter((fid) => normalizeFid(fid) != null);
  if (unique.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("fid, username")
    .in("fid", unique);

  if (error) {
    throw new Error(`referrals: failed to load referred accounts: ${error.message}`);
  }

  return new Map((data ?? []).map((row) => [row.fid, row.username ?? null]));
}
