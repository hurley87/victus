import "server-only";

import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

import { utcCurrentMonthString, utcMonthBounds } from "@/lib/scoring/dates";

export type LeaderboardEntry = {
  rank: number;
  user_id: string;
  fid: number;
  username: string | null;
  points: number;
  realized_pnl_usdc: number;
  last_trade_at: string | null;
  /** True for the `COMMODUS_FID` system player — UI themes as Emperor / boss. */
  is_commodus: boolean;
};

export type CurrentLeaderboardResult = {
  month: string;
  entries: LeaderboardEntry[];
};

export async function getCurrentMonthLeaderboard(): Promise<CurrentLeaderboardResult> {
  const month = utcCurrentMonthString();
  const { startIso, endIso } = utcMonthBounds(month);

  const [{ data: scoringRows, error: scoringErr }, { data: execRows, error: execErr }] =
    await Promise.all([
      supabaseAdmin
        .from("scoring_events")
        .select("user_id, points, created_at")
        .eq("month", month),
      supabaseAdmin
        .from("trade_executions")
        .select("id, realized_pnl_usdc, confirmed_at, trade_intent_id")
        .eq("status", "confirmed")
        .gte("confirmed_at", startIso)
        .lt("confirmed_at", endIso),
    ]);

  if (scoringErr) {
    throw new Error(`leaderboard: scoring_events ${scoringErr.message}`);
  }
  if (execErr) {
    throw new Error(`leaderboard: trade_executions ${execErr.message}`);
  }

  const pointsByUser = new Map<string, number>();
  const earliestTsByUser = new Map<string, number>();

  for (const row of scoringRows ?? []) {
    const uid = row.user_id;
    pointsByUser.set(uid, (pointsByUser.get(uid) ?? 0) + row.points);
    const ts = new Date(row.created_at).getTime();
    const prev = earliestTsByUser.get(uid);
    if (prev === undefined || ts < prev) {
      earliestTsByUser.set(uid, ts);
    }
  }

  const intentIds = [
    ...new Set(
      (execRows ?? [])
        .map((e) => e.trade_intent_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  let intents: { id: string; action: string; wallet_id: string }[] = [];
  if (intentIds.length > 0) {
    const { data, error: intentErr } = await supabaseAdmin
      .from("trade_intents")
      .select("id, action, wallet_id")
      .in("id", intentIds);
    if (intentErr) {
      throw new Error(`leaderboard: trade_intents ${intentErr.message}`);
    }
    intents = data ?? [];
  }

  const intentById = new Map(intents.map((i) => [i.id, i]));

  const walletIds = [
    ...new Set(
      intents
        .map((i) => i.wallet_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  let wallets: { id: string; user_id: string }[] = [];
  if (walletIds.length > 0) {
    const { data, error: walletErr } = await supabaseAdmin
      .from("arena_wallets")
      .select("id, user_id")
      .in("id", walletIds);
    if (walletErr) {
      throw new Error(`leaderboard: arena_wallets ${walletErr.message}`);
    }
    wallets = data ?? [];
  }

  const userIdByWallet = new Map(wallets.map((w) => [w.id, w.user_id]));

  const pnlByUser = new Map<string, number>();
  const lastTradeByUser = new Map<string, number>();

  for (const ex of execRows ?? []) {
    const intent = intentById.get(ex.trade_intent_id);
    if (!intent) continue;
    const userId = userIdByWallet.get(intent.wallet_id);
    if (!userId) continue;

    const confirmed = ex.confirmed_at
      ? new Date(ex.confirmed_at).getTime()
      : Number.NaN;
    if (Number.isFinite(confirmed)) {
      const prevLast = lastTradeByUser.get(userId);
      if (prevLast === undefined || confirmed > prevLast) {
        lastTradeByUser.set(userId, confirmed);
      }
    }

    if (intent.action === "sell" && ex.realized_pnl_usdc != null) {
      const pnl = Number(ex.realized_pnl_usdc);
      pnlByUser.set(userId, (pnlByUser.get(userId) ?? 0) + pnl);
    }
  }

  const baseList = [
    ...new Set([...pointsByUser.keys(), ...pnlByUser.keys()]),
  ];

  const commodusFidN =
    env.COMMODUS_FID != null ? Number(env.COMMODUS_FID) : null;
  const commodusUserId = commodusFidN
    ? await loadUserIdByFid(commodusFidN)
    : null;

  const userIdListOut =
    commodusUserId && !baseList.includes(commodusUserId)
      ? [...baseList, commodusUserId]
      : baseList;

  if (userIdListOut.length === 0) {
    return { month, entries: [] };
  }

  const { data: accounts, error: acctErr } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id, fid, username")
    .in("user_id", userIdListOut);

  if (acctErr) {
    throw new Error(`leaderboard: farcaster_accounts ${acctErr.message}`);
  }

  const fidByUser = new Map(
    (accounts ?? []).map((a) => [a.user_id, a.fid]),
  );
  const usernameByUser = new Map(
    (accounts ?? []).map((a) => [a.user_id, a.username]),
  );

  const entries: LeaderboardEntry[] = userIdListOut.map((user_id) => {
    const lastTs = lastTradeByUser.get(user_id);
    const fid = fidByUser.get(user_id) ?? 0;
    return {
      rank: 0,
      user_id,
      fid,
      username: usernameByUser.get(user_id) ?? null,
      points: pointsByUser.get(user_id) ?? 0,
      realized_pnl_usdc: pnlByUser.get(user_id) ?? 0,
      last_trade_at: lastTs != null ? new Date(lastTs).toISOString() : null,
      is_commodus: commodusFidN != null && fid === commodusFidN,
    };
  });

  entries.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.realized_pnl_usdc !== a.realized_pnl_usdc) {
      return b.realized_pnl_usdc - a.realized_pnl_usdc;
    }
    const tieA = earliestTsByUser.get(a.user_id) ?? Number.POSITIVE_INFINITY;
    const tieB = earliestTsByUser.get(b.user_id) ?? Number.POSITIVE_INFINITY;
    return tieA - tieB;
  });

  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  return { month, entries };
}

async function loadUserIdByFid(fid: number): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id")
    .eq("fid", fid)
    .maybeSingle();
  if (error) {
    throw new Error(`leaderboard: commodus user lookup ${error.message}`);
  }
  return data?.user_id ?? null;
}
