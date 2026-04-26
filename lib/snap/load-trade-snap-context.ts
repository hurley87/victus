import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { loadStatusViewContext } from "@/lib/status/load-context";

import type { TradeSnapContext } from "./build-trade-snap";

function isTradeAction(value: string): value is "buy" | "sell" {
  return value === "buy" || value === "sell";
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Loads a trade Snap read model and proves the trade execution belongs to the FID.
 */
export async function loadTradeSnapContext(
  fid: number,
  tradeExecutionId: string,
): Promise<TradeSnapContext | null> {
  const id = tradeExecutionId.trim();
  if (!id) return null;

  const { data: execution, error: executionErr } = await supabaseAdmin
    .from("trade_executions")
    .select(
      "id, status, quantity, notional_usdc, realized_pnl_usdc, tx_hash, trade_intent_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (executionErr) {
    throw new Error(`trade snap: trade_executions ${executionErr.message}`);
  }
  if (!execution) {
    return null;
  }

  const { data: intent, error: intentErr } = await supabaseAdmin
    .from("trade_intents")
    .select("action, asset_symbol, wallet_id")
    .eq("id", execution.trade_intent_id)
    .maybeSingle();

  if (intentErr) {
    throw new Error(`trade snap: trade_intents ${intentErr.message}`);
  }
  if (!intent || !isTradeAction(intent.action)) {
    return null;
  }

  const { data: wallet, error: walletErr } = await supabaseAdmin
    .from("arena_wallets")
    .select("user_id")
    .eq("id", intent.wallet_id)
    .maybeSingle();

  if (walletErr) {
    throw new Error(`trade snap: arena_wallets ${walletErr.message}`);
  }
  if (!wallet) {
    return null;
  }

  const { data: account, error: accountErr } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("id")
    .eq("user_id", wallet.user_id)
    .eq("fid", fid)
    .maybeSingle();

  if (accountErr) {
    throw new Error(`trade snap: farcaster_accounts ${accountErr.message}`);
  }
  if (!account) {
    return null;
  }

  const status = await loadStatusViewContext(fid);
  if (!status) {
    return null;
  }

  return {
    displayHandle: status.displayHandle,
    rank: status.rank,
    arenaValueUsdc: status.arenaValueUsdc,
    performanceReturn: status.performanceReturn,
    dailySlotsRemaining: status.dailySlotsRemaining,
    trade: {
      action: intent.action,
      symbol: intent.asset_symbol,
      status: execution.status,
      quantity: toNum(execution.quantity),
      notionalUsdc: toNum(execution.notional_usdc),
      realizedPnlUsdc: toNum(execution.realized_pnl_usdc),
      txHash: execution.tx_hash,
    },
  };
}
