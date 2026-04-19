import "server-only";

import type { PolicyContext } from "./policy";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Reserve-before-submit bookkeeping for the quote_swap step.
 *
 * Two rows are materialized in order:
 *
 *   1. `trade_intents` — FK'd to `cast_commands`. Its `cast_command_id`
 *      is UNIQUE, so a replay that re-runs this helper simply picks up
 *      the existing row.
 *   2. `trade_executions` — the reservation. `execution_id` is UNIQUE
 *      and derived deterministically from `cast_hash`, so a replay
 *      observes the pre-existing `pending` row and downstream steps
 *      know to pick up from there (e.g. skip straight to verify if
 *      `tx_hash` is populated).
 *
 * Callers pass the deterministic `executionId` + already-computed
 * `feeUsdc` so the pure helpers stay isolated and the DB-facing step
 * is a narrow idempotent insert.
 */

export type ReserveExecutionParams = {
  castCommandId: string;
  ctx: PolicyContext;
  intent: {
    action: "buy" | "sell";
    symbol: string;
    amount_type: "usdc_in" | "percent_out";
    amount_value: number;
  };
  executionId: string;
  feeUsdc: number;
  notionalUsdc: number;
};

export type ReservedExecution = {
  tradeIntentId: string;
  tradeExecutionId: string;
  /** Populated on pickup of a replay where `submit_swap` already ran. */
  txHash: string | null;
  /** Populated if `verify_tx_onchain` already confirmed this row. */
  confirmedAt: string | null;
  privyTransactionId: string | null;
  status: string;
};

export async function reserveOrLoadExecution(
  params: ReserveExecutionParams,
): Promise<ReservedExecution> {
  const tradeIntentId = await upsertTradeIntent(params);
  return await upsertTradeExecution({ ...params, tradeIntentId });
}

async function upsertTradeIntent(
  params: ReserveExecutionParams,
): Promise<string> {
  // cast_command_id is UNIQUE; ignoreDuplicates turns a replay into a no-op.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("trade_intents")
    .select("id")
    .eq("cast_command_id", params.castCommandId)
    .maybeSingle();

  if (readErr) {
    throw new Error(`trade_intents lookup failed: ${readErr.message}`);
  }
  if (existing) return existing.id;

  const { data, error } = await supabaseAdmin
    .from("trade_intents")
    .insert({
      cast_command_id: params.castCommandId,
      wallet_id: params.ctx.walletId,
      action: params.intent.action,
      asset_symbol: params.intent.symbol,
      amount_type: params.intent.amount_type,
      amount_value: params.intent.amount_value,
      status: "quoted",
    })
    .select("id")
    .single();

  if (error) {
    // Concurrent insert lost the race — re-read is safe because the
    // winning row is identical shape.
    if (isUniqueViolation(error)) {
      const { data: second } = await supabaseAdmin
        .from("trade_intents")
        .select("id")
        .eq("cast_command_id", params.castCommandId)
        .single();
      if (second) return second.id;
    }
    throw new Error(`trade_intents insert failed: ${error.message}`);
  }

  return data.id;
}

async function upsertTradeExecution(
  params: ReserveExecutionParams & { tradeIntentId: string },
): Promise<ReservedExecution> {
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("trade_executions")
    .select(
      "id, status, tx_hash, confirmed_at, privy_transaction_id",
    )
    .eq("execution_id", params.executionId)
    .maybeSingle();

  if (readErr) {
    throw new Error(`trade_executions lookup failed: ${readErr.message}`);
  }

  if (existing) {
    return {
      tradeIntentId: params.tradeIntentId,
      tradeExecutionId: existing.id,
      txHash: existing.tx_hash,
      confirmedAt: existing.confirmed_at,
      privyTransactionId: existing.privy_transaction_id,
      status: existing.status,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("trade_executions")
    .insert({
      trade_intent_id: params.tradeIntentId,
      execution_id: params.executionId,
      notional_usdc: params.notionalUsdc,
      swap_fee_usdc: params.feeUsdc,
      status: "pending",
    })
    .select("id, status, tx_hash, confirmed_at, privy_transaction_id")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: second } = await supabaseAdmin
        .from("trade_executions")
        .select(
          "id, status, tx_hash, confirmed_at, privy_transaction_id",
        )
        .eq("execution_id", params.executionId)
        .single();
      if (second) {
        return {
          tradeIntentId: params.tradeIntentId,
          tradeExecutionId: second.id,
          txHash: second.tx_hash,
          confirmedAt: second.confirmed_at,
          privyTransactionId: second.privy_transaction_id,
          status: second.status,
        };
      }
    }
    throw new Error(`trade_executions insert failed: ${error.message}`);
  }

  return {
    tradeIntentId: params.tradeIntentId,
    tradeExecutionId: data.id,
    txHash: data.tx_hash,
    confirmedAt: data.confirmed_at,
    privyTransactionId: data.privy_transaction_id,
    status: data.status,
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
