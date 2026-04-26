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

export type ApplySeasonSellParams = ApplySeasonBuyParams;

export type ApplySeasonTradeResult =
  | { applied: true }
  | { applied: false; reason: "duplicate" | "not_confirmed" | "missing_fields" };

const TRADE_EXECUTION_SELECT =
  "id, status, notional_usdc, quantity, execution_price_usdc, swap_fee_usdc, tx_hash" as const;

type SeasonExecutionSnapshot = {
  notional: number;
  quantity: number;
  executionPrice: number;
  fees: number;
  txHash: string | null;
};

type LoadExecutionIssue = "not_confirmed" | "missing_fields";

async function loadSeasonExecutionSnapshot(
  client: SupabaseAdmin,
  tradeExecutionId: string,
  op: "applySeasonBuy" | "applySeasonSell",
): Promise<SeasonExecutionSnapshot | LoadExecutionIssue> {
  const { data: exec, error: execErr } = await client
    .from("trade_executions")
    .select(TRADE_EXECUTION_SELECT)
    .eq("id", tradeExecutionId)
    .maybeSingle();

  if (execErr) {
    throw new Error(`${op}: load trade_executions ${execErr.message}`);
  }
  if (!exec) {
    throw new Error(`${op}: trade_execution ${tradeExecutionId} not found`);
  }
  if (exec.status !== "confirmed") {
    return "not_confirmed";
  }
  if (
    exec.notional_usdc == null ||
    exec.quantity == null ||
    exec.execution_price_usdc == null
  ) {
    return "missing_fields";
  }

  return {
    notional: Number(exec.notional_usdc),
    quantity: Number(exec.quantity),
    executionPrice: Number(exec.execution_price_usdc),
    fees: exec.swap_fee_usdc != null ? Number(exec.swap_fee_usdc) : 0,
    txHash: exec.tx_hash ?? null,
  };
}

async function insertSeasonExecutionTrade(
  client: SupabaseAdmin,
  params: ApplySeasonBuyParams,
  action: "buy" | "sell",
  snap: SeasonExecutionSnapshot,
): Promise<ApplySeasonTradeResult> {
  const { error: insertErr } = await client.from("season_trades").insert({
    season_id: params.seasonId,
    season_entry_id: params.seasonEntryId,
    user_id: params.userId,
    wallet_id: params.walletId,
    trade_execution_id: params.tradeExecutionId,
    action,
    token_symbol: params.tokenSymbol,
    token_address: params.tokenAddress,
    notional_usdc: snap.notional,
    token_amount: snap.quantity,
    execution_price: snap.executionPrice,
    fees_usdc: snap.fees,
    tx_hash: snap.txHash,
    status: "executed",
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return { applied: false, reason: "duplicate" };
    }
    const op = action === "buy" ? "applySeasonBuy" : "applySeasonSell";
    throw new Error(`${op}: insert season_trades ${insertErr.message}`);
  }

  return { applied: true };
}

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
  // Idempotency: unique (trade_execution_id) → 23505 on replay; we no-op.
  const loaded = await loadSeasonExecutionSnapshot(
    client,
    params.tradeExecutionId,
    "applySeasonBuy",
  );
  if (loaded === "not_confirmed") {
    return { applied: false, reason: "not_confirmed" };
  }
  if (loaded === "missing_fields") {
    return { applied: false, reason: "missing_fields" };
  }

  const insertResult = await insertSeasonExecutionTrade(
    client,
    params,
    "buy",
    loaded,
  );
  if (!insertResult.applied) {
    return insertResult;
  }

  await mutateSeasonEntryAfterTrade(
    {
      direction: "buy",
      seasonEntryId: params.seasonEntryId,
      seasonId: params.seasonId,
      notional: loaded.notional,
      fees: loaded.fees,
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
      addAmount: loaded.quantity,
      executionPrice: loaded.executionPrice,
    },
    client,
  );

  return { applied: true };
}

/**
 * Post-execution hook for a Victus Games sell. Uses the confirmed swap row
 * as source of truth, inserts one idempotency-guarded `season_trades` row,
 * then credits virtual cash and decrements the current season position.
 */
export async function applySeasonSell(
  params: ApplySeasonSellParams,
  client: SupabaseAdmin = supabaseAdmin,
): Promise<ApplySeasonTradeResult> {
  const loaded = await loadSeasonExecutionSnapshot(
    client,
    params.tradeExecutionId,
    "applySeasonSell",
  );
  if (loaded === "not_confirmed") {
    return { applied: false, reason: "not_confirmed" };
  }
  if (loaded === "missing_fields") {
    return { applied: false, reason: "missing_fields" };
  }

  const insertResult = await insertSeasonExecutionTrade(
    client,
    params,
    "sell",
    loaded,
  );
  if (!insertResult.applied) {
    return insertResult;
  }

  await mutateSeasonEntryAfterTrade(
    {
      direction: "sell",
      seasonEntryId: params.seasonEntryId,
      seasonId: params.seasonId,
      notional: loaded.notional,
      fees: loaded.fees,
    },
    client,
  );

  await decrementSeasonPositionForSell(
    {
      seasonEntryId: params.seasonEntryId,
      tokenSymbol: params.tokenSymbol,
      soldAmount: loaded.quantity,
    },
    client,
  );

  return { applied: true };
}

async function mutateSeasonEntryAfterTrade(
  args: {
    direction: "buy" | "sell";
    seasonEntryId: string;
    seasonId: string;
    notional: number;
    fees: number;
  },
  client: SupabaseAdmin,
): Promise<void> {
  const op = args.direction === "buy" ? "applySeasonBuy" : "applySeasonSell";
  const { data: entry, error } = await client
    .from("season_entries")
    .select(
      "cash_remaining_usdc, trades_used, has_qualifying_trade, season_id",
    )
    .eq("id", args.seasonEntryId)
    .maybeSingle();

  if (error) {
    throw new Error(`${op}: load entry ${error.message}`);
  }
  if (!entry) {
    throw new Error(`${op}: entry ${args.seasonEntryId} not found`);
  }

  const { data: season, error: seasonErr } = await client
    .from("seasons")
    .select("min_trade_size_usdc")
    .eq("id", args.seasonId)
    .maybeSingle();

  if (seasonErr) {
    throw new Error(`${op}: load season ${seasonErr.message}`);
  }
  if (!season) {
    throw new Error(`${op}: season ${args.seasonId} not found`);
  }

  const minTrade = Number(season.min_trade_size_usdc);
  const cash = Number(entry.cash_remaining_usdc);
  const newCash =
    args.direction === "buy"
      ? cash - args.notional - args.fees
      : cash + args.notional - args.fees;
  const qualifies =
    entry.has_qualifying_trade || args.notional + 1e-9 >= minTrade;

  const { error: updErr } = await client
    .from("season_entries")
    .update({
      cash_remaining_usdc: newCash,
      trades_used: entry.trades_used + 1,
      has_qualifying_trade: qualifies,
    })
    .eq("id", args.seasonEntryId);

  if (updErr) {
    throw new Error(`${op}: update entry ${updErr.message}`);
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

async function decrementSeasonPositionForSell(
  args: {
    seasonEntryId: string;
    tokenSymbol: string;
    soldAmount: number;
  },
  client: SupabaseAdmin,
): Promise<void> {
  const { data: existing, error } = await client
    .from("season_positions")
    .select("id, token_amount")
    .eq("season_entry_id", args.seasonEntryId)
    .eq("token_symbol", args.tokenSymbol)
    .maybeSingle();

  if (error) {
    throw new Error(`applySeasonSell: load position ${error.message}`);
  }
  if (!existing) {
    throw new Error(`applySeasonSell: position ${args.tokenSymbol} not found`);
  }

  const remaining = Number(existing.token_amount) - args.soldAmount;
  if (remaining < 1e-12) {
    const { error: delErr } = await client
      .from("season_positions")
      .delete()
      .eq("id", existing.id);
    if (delErr) {
      throw new Error(`applySeasonSell: delete position ${delErr.message}`);
    }
    return;
  }

  const { error: updErr } = await client
    .from("season_positions")
    .update({ token_amount: remaining })
    .eq("id", existing.id);

  if (updErr) {
    throw new Error(`applySeasonSell: update position ${updErr.message}`);
  }
}
