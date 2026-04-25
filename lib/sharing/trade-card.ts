import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";

export type TradeShareCard = {
  execution_id: string;
  fid: number;
  username: string | null;
  action: "buy" | "sell";
  symbol: string;
  notional_usdc: number | null;
  realized_pnl_usdc: number | null;
  points: number;
  confirmed_at: string | null;
};

/**
 * Fetch the data needed to render a per-trade OG share card. Returns null if
 * the execution is missing, unconfirmed, or cannot be joined to a Farcaster
 * account.
 */
export async function getTradeShareCard(
  executionId: string,
): Promise<TradeShareCard | null> {
  const id = executionId.trim();
  if (!id) return null;

  const { data: execution, error: execErr } = await supabaseAdmin
    .from("trade_executions")
    .select("id, status, notional_usdc, realized_pnl_usdc, confirmed_at, trade_intent_id")
    .eq("id", id)
    .maybeSingle();
  if (execErr) {
    throw new Error(`getTradeShareCard: trade_executions ${execErr.message}`);
  }
  if (!execution || execution.status !== "confirmed") return null;
  if (!execution.trade_intent_id) return null;

  const { data: intent, error: intentErr } = await supabaseAdmin
    .from("trade_intents")
    .select("id, action, asset_symbol, wallet_id")
    .eq("id", execution.trade_intent_id)
    .maybeSingle();
  if (intentErr) {
    throw new Error(`getTradeShareCard: trade_intents ${intentErr.message}`);
  }
  if (!intent || !intent.wallet_id) return null;

  const { data: wallet, error: walletErr } = await supabaseAdmin
    .from("arena_wallets")
    .select("id, user_id")
    .eq("id", intent.wallet_id)
    .maybeSingle();
  if (walletErr) {
    throw new Error(`getTradeShareCard: arena_wallets ${walletErr.message}`);
  }
  if (!wallet) return null;

  const { data: account, error: acctErr } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id, fid, username")
    .eq("user_id", wallet.user_id)
    .maybeSingle();
  if (acctErr) {
    throw new Error(`getTradeShareCard: farcaster_accounts ${acctErr.message}`);
  }
  if (!account) return null;

  const { data: scoreRows, error: scoreErr } = await supabaseAdmin
    .from("scoring_events")
    .select("points")
    .eq("execution_id", id);
  if (scoreErr) {
    throw new Error(`getTradeShareCard: scoring_events ${scoreErr.message}`);
  }

  const points = (scoreRows ?? []).reduce(
    (sum, r) => sum + Number(r.points ?? 0),
    0,
  );

  return {
    execution_id: id,
    fid: account.fid,
    username: account.username,
    action: intent.action as "buy" | "sell",
    symbol: intent.asset_symbol ?? "",
    notional_usdc:
      execution.notional_usdc != null ? Number(execution.notional_usdc) : null,
    realized_pnl_usdc:
      execution.realized_pnl_usdc != null
        ? Number(execution.realized_pnl_usdc)
        : null,
    points,
    confirmed_at: execution.confirmed_at,
  };
}
