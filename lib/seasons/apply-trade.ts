import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type SupabaseAdmin = SupabaseClient<Database>;

export type ApplySeasonBuyParams = {
  tradeExecutionId: string;
  seasonId: string;
  seasonEntryId: string;
  userId: string;
  walletId: string;
  tokenSymbol: string;
  tokenAddress: string;
};

export type ApplySeasonTradeResult =
  | { applied: true }
  | { applied: false; reason: "duplicate" | "not_confirmed" | "missing_fields" };

/**
 * Post-execution hook for a Victus Games buy. Idempotent on
 * `season_trades.trade_execution_id`: a duplicate call short-circuits
 * before mutating `season_entries` / `season_positions`.
 *
 * Pre-conditions:
 *   - `trade_executions.status === 'confirmed'`. Failed swaps must
 *     never call this hook (no ticket consumed).
 *   - `notional_usdc`, `quantity`, `execution_price_usdc` populated by
 *     `decode_swap_log`.
 */
export async function applySeasonBuy(
  params: ApplySeasonBuyParams,
  client: SupabaseAdmin = supabaseAdmin,
): Promise<ApplySeasonTradeResult> {
  const { data: exec, error: execErr } = await client
    .from("trade_executions")
    .select(
      "id, status, notional_usdc, quantity, execution_price_usdc, swap_fee_usdc, tx_hash",
    )
    .eq("id", params.tradeExecutionId)
    .maybeSingle();

  if (execErr) {
    throw new Error(`applySeasonBuy: load trade_executions ${execErr.message}`);
  }
  if (!exec) {
    throw new Error(
      `applySeasonBuy: trade_execution ${params.tradeExecutionId} not found`,
    );
  }
  if (exec.status !== "confirmed") {
    return { applied: false, reason: "not_confirmed" };
  }
  if (
    exec.notional_usdc == null ||
    exec.quantity == null ||
    exec.execution_price_usdc == null
  ) {
    return { applied: false, reason: "missing_fields" };
  }

  const notional = Number(exec.notional_usdc);
  const quantity = Number(exec.quantity);
  const executionPrice = Number(exec.execution_price_usdc);
  const fees = exec.swap_fee_usdc != null ? Number(exec.swap_fee_usdc) : 0;

  // Idempotency gate. The unique index on (trade_execution_id) flips
  // 23505 on a replay; we treat it as a no-op.
  const { error: insertErr } = await client.from("season_trades").insert({
    season_id: params.seasonId,
    season_entry_id: params.seasonEntryId,
    user_id: params.userId,
    wallet_id: params.walletId,
    trade_execution_id: params.tradeExecutionId,
    action: "buy",
    token_symbol: params.tokenSymbol,
    token_address: params.tokenAddress,
    notional_usdc: notional,
    token_amount: quantity,
    execution_price: executionPrice,
    fees_usdc: fees,
    tx_hash: exec.tx_hash ?? null,
    status: "executed",
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return { applied: false, reason: "duplicate" };
    }
    throw new Error(`applySeasonBuy: insert season_trades ${insertErr.message}`);
  }

  await mutateSeasonEntryForBuy(
    {
      seasonEntryId: params.seasonEntryId,
      seasonId: params.seasonId,
      notional,
      fees,
    },
    client,
  );

  await upsertSeasonPositionForBuy(
    {
      seasonId: params.seasonId,
      seasonEntryId: params.seasonEntryId,
      userId: params.userId,
      tokenSymbol: params.tokenSymbol,
      tokenAddress: params.tokenAddress,
      addAmount: quantity,
      executionPrice,
    },
    client,
  );

  return { applied: true };
}

async function mutateSeasonEntryForBuy(
  args: {
    seasonEntryId: string;
    seasonId: string;
    notional: number;
    fees: number;
  },
  client: SupabaseAdmin,
): Promise<void> {
  const { data: entry, error } = await client
    .from("season_entries")
    .select(
      "cash_remaining_usdc, trades_used, has_qualifying_trade, season_id",
    )
    .eq("id", args.seasonEntryId)
    .maybeSingle();

  if (error) {
    throw new Error(`applySeasonBuy: load entry ${error.message}`);
  }
  if (!entry) {
    throw new Error(`applySeasonBuy: entry ${args.seasonEntryId} not found`);
  }

  const { data: season, error: seasonErr } = await client
    .from("seasons")
    .select("min_trade_size_usdc")
    .eq("id", args.seasonId)
    .maybeSingle();

  if (seasonErr) {
    throw new Error(`applySeasonBuy: load season ${seasonErr.message}`);
  }
  if (!season) {
    throw new Error(`applySeasonBuy: season ${args.seasonId} not found`);
  }

  const minTrade = Number(season.min_trade_size_usdc);
  const newCash = Number(entry.cash_remaining_usdc) - args.notional - args.fees;
  const qualifies = entry.has_qualifying_trade || args.notional + 1e-9 >= minTrade;

  const { error: updErr } = await client
    .from("season_entries")
    .update({
      cash_remaining_usdc: newCash,
      trades_used: entry.trades_used + 1,
      has_qualifying_trade: qualifies,
    })
    .eq("id", args.seasonEntryId);

  if (updErr) {
    throw new Error(`applySeasonBuy: update entry ${updErr.message}`);
  }
}

async function upsertSeasonPositionForBuy(
  args: {
    seasonId: string;
    seasonEntryId: string;
    userId: string;
    tokenSymbol: string;
    tokenAddress: string;
    addAmount: number;
    executionPrice: number;
  },
  client: SupabaseAdmin,
): Promise<void> {
  const { data: existing, error } = await client
    .from("season_positions")
    .select("id, token_amount, average_entry_price")
    .eq("season_entry_id", args.seasonEntryId)
    .eq("token_symbol", args.tokenSymbol)
    .maybeSingle();

  if (error) {
    throw new Error(`applySeasonBuy: load position ${error.message}`);
  }

  if (!existing) {
    const { error: insErr } = await client.from("season_positions").insert({
      season_id: args.seasonId,
      season_entry_id: args.seasonEntryId,
      user_id: args.userId,
      token_symbol: args.tokenSymbol,
      token_address: args.tokenAddress,
      token_amount: args.addAmount,
      average_entry_price: args.executionPrice,
    });
    if (insErr) {
      throw new Error(`applySeasonBuy: insert position ${insErr.message}`);
    }
    return;
  }

  const oldAmount = Number(existing.token_amount);
  const oldAvg = Number(existing.average_entry_price);
  const newAmount = oldAmount + args.addAmount;
  const newAvg =
    newAmount > 0
      ? (oldAvg * oldAmount + args.executionPrice * args.addAmount) / newAmount
      : args.executionPrice;

  const { error: updErr } = await client
    .from("season_positions")
    .update({
      token_amount: newAmount,
      average_entry_price: newAvg,
    })
    .eq("id", existing.id);

  if (updErr) {
    throw new Error(`applySeasonBuy: update position ${updErr.message}`);
  }
}
