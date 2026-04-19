import type { Database } from "@/lib/supabase/types";

import {
  POINTS_PROFITABLE_CLOSE,
  POINTS_RETURN_10_BONUS,
  POINTS_RETURN_25_BONUS,
  POINTS_TRADE_EXECUTED,
  PROFITABLE_CLOSE_MIN_USDC,
  RETURN_BONUS_10_PCT,
  RETURN_BONUS_25_PCT,
} from "./constants";

export type TradeScoreRowInsert = Pick<
  Database["public"]["Tables"]["scoring_events"]["Insert"],
  "event_type" | "points" | "counted_in_daily_slot" | "month"
> & {
  user_id: string;
  cast_command_id: string;
  execution_id: string | null;
};

const EPS = 1e-9;

export function buildTradeScoreRows(params: {
  userId: string;
  castCommandId: string;
  tradeExecutionId: string;
  month: string;
  intentAction: "buy" | "sell";
  earnsPointsThisUtcDay: boolean;
  realizedPnlUsdc: number | null;
  realizedReturnPct: number | null;
}): TradeScoreRowInsert[] {
  const counted = params.earnsPointsThisUtcDay;
  const mult = counted ? 1 : 0;

  const common = {
    user_id: params.userId,
    cast_command_id: params.castCommandId,
    execution_id: params.tradeExecutionId,
    month: params.month,
    counted_in_daily_slot: counted,
  } as const;

  const rows: TradeScoreRowInsert[] = [
    {
      ...common,
      event_type: "trade_executed",
      points: POINTS_TRADE_EXECUTED * mult,
    },
  ];

  if (params.intentAction !== "sell") {
    return rows;
  }

  const pnl = params.realizedPnlUsdc;
  const ret = params.realizedReturnPct;

  if (pnl != null && pnl + EPS >= PROFITABLE_CLOSE_MIN_USDC) {
    rows.push({
      ...common,
      event_type: "profitable_close",
      points: POINTS_PROFITABLE_CLOSE * mult,
    });
  }

  if (ret != null && ret + EPS >= RETURN_BONUS_25_PCT) {
    rows.push({
      ...common,
      event_type: "return_25_bonus",
      points: POINTS_RETURN_25_BONUS * mult,
    });
  }

  if (ret != null && ret + EPS >= RETURN_BONUS_10_PCT) {
    rows.push({
      ...common,
      event_type: "return_10_bonus",
      points: POINTS_RETURN_10_BONUS * mult,
    });
  }

  return rows;
}
