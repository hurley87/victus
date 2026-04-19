import "server-only";

import { isUniqueViolation } from "@/lib/execution/reserve";
import { supabaseAdmin } from "@/lib/supabase/server";

import { buildTradeScoreRows } from "./build-trade-score";
import { SCORING_CASTS_PER_UTC_DAY } from "./constants";
import { utcDayRangeFromTimestamp, utcMonthFromTimestamp } from "./dates";

async function countScoringSlotsUsedOnUtcDay(params: {
  userId: string;
  dayStartIso: string;
  dayEndIso: string;
  excludeExecutionId: string;
}): Promise<number> {
  const { data: events, error } = await supabaseAdmin
    .from("scoring_events")
    .select("execution_id")
    .eq("user_id", params.userId)
    .eq("event_type", "trade_executed")
    .eq("counted_in_daily_slot", true)
    .not("execution_id", "is", null);

  if (error) {
    throw new Error(`countScoringSlots: scoring_events read failed: ${error.message}`);
  }

  const executionIds = [
    ...new Set(
      (events ?? [])
        .map((e) => e.execution_id)
        .filter(
          (id): id is string =>
            typeof id === "string" &&
            id.length > 0 &&
            id !== params.excludeExecutionId,
        ),
    ),
  ];

  if (executionIds.length === 0) {
    return 0;
  }

  const { data: execs, error: execErr } = await supabaseAdmin
    .from("trade_executions")
    .select("id")
    .in("id", executionIds)
    .gte("confirmed_at", params.dayStartIso)
    .lt("confirmed_at", params.dayEndIso);

  if (execErr) {
    throw new Error(`countScoringSlots: trade_executions read failed: ${execErr.message}`);
  }

  return execs?.length ?? 0;
}

/**
 * Append `scoring_events` for a confirmed execution. Idempotent per
 * `(cast_command_id, event_type)` — workflow replays no-op on conflict.
 */
export async function scoreTradeAfterExecution(params: {
  castCommandId: string;
  userId: string;
  tradeExecutionId: string;
  intentAction: "buy" | "sell";
}): Promise<void> {
  const { data: execution, error: execReadErr } = await supabaseAdmin
    .from("trade_executions")
    .select("confirmed_at, realized_pnl_usdc, realized_return_pct")
    .eq("id", params.tradeExecutionId)
    .maybeSingle();

  if (execReadErr) {
    throw new Error(`score_trade: read execution failed: ${execReadErr.message}`);
  }

  const confirmedAt = execution?.confirmed_at;
  if (!confirmedAt) {
    throw new Error("score_trade: execution missing confirmed_at");
  }

  const month = utcMonthFromTimestamp(confirmedAt);
  const { startIso, endIso } = utcDayRangeFromTimestamp(confirmedAt);

  const { data: existingEvents, error: existingErr } = await supabaseAdmin
    .from("scoring_events")
    .select("event_type, counted_in_daily_slot")
    .eq("cast_command_id", params.castCommandId);

  if (existingErr) {
    throw new Error(`score_trade: read existing scoring failed: ${existingErr.message}`);
  }

  const existingTypes = new Set((existingEvents ?? []).map((e) => e.event_type));
  const baseRow = (existingEvents ?? []).find((e) => e.event_type === "trade_executed");

  let earnsPointsThisUtcDay: boolean;
  if (baseRow) {
    earnsPointsThisUtcDay = baseRow.counted_in_daily_slot;
  } else {
    const slotsUsed = await countScoringSlotsUsedOnUtcDay({
      userId: params.userId,
      dayStartIso: startIso,
      dayEndIso: endIso,
      excludeExecutionId: params.tradeExecutionId,
    });
    earnsPointsThisUtcDay = slotsUsed < SCORING_CASTS_PER_UTC_DAY;
  }

  const pnl =
    execution?.realized_pnl_usdc != null
      ? Number(execution.realized_pnl_usdc)
      : null;
  const ret =
    execution?.realized_return_pct != null
      ? Number(execution.realized_return_pct)
      : null;

  const rows = buildTradeScoreRows({
    userId: params.userId,
    castCommandId: params.castCommandId,
    tradeExecutionId: params.tradeExecutionId,
    month,
    intentAction: params.intentAction,
    earnsPointsThisUtcDay,
    realizedPnlUsdc: params.intentAction === "sell" ? pnl : null,
    realizedReturnPct: params.intentAction === "sell" ? ret : null,
  });

  for (const row of rows) {
    if (existingTypes.has(row.event_type)) {
      continue;
    }
    const { error } = await supabaseAdmin.from("scoring_events").insert(row);
    if (error && !isUniqueViolation(error)) {
      console.error("score_trade insert failed", error);
    }
  }
}
