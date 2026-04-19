import { describe, expect, it } from "vitest";

import { buildTradeScoreRows } from "./build-trade-score";

describe("buildTradeScoreRows", () => {
  const base = {
    userId: "u1",
    castCommandId: "c1",
    tradeExecutionId: "e1",
    month: "2026-04",
  };

  it("awards +1 on buys when a scoring slot is available", () => {
    const rows = buildTradeScoreRows({
      ...base,
      intentAction: "buy",
      earnsPointsThisUtcDay: true,
      realizedPnlUsdc: null,
      realizedReturnPct: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: "trade_executed",
      points: 1,
      counted_in_daily_slot: true,
    });
  });

  it("zeros points but preserves rows when no scoring slot", () => {
    const rows = buildTradeScoreRows({
      ...base,
      intentAction: "sell",
      earnsPointsThisUtcDay: false,
      realizedPnlUsdc: 5,
      realizedReturnPct: 40,
    });
    expect(rows.every((r) => r.points === 0)).toBe(true);
    expect(rows.every((r) => r.counted_in_daily_slot === false)).toBe(true);
    expect(rows.map((r) => r.event_type)).toEqual([
      "trade_executed",
      "profitable_close",
      "return_25_bonus",
      "return_10_bonus",
    ]);
  });

  it("stacks profitable close and return bonuses on a strong sell", () => {
    const rows = buildTradeScoreRows({
      ...base,
      intentAction: "sell",
      earnsPointsThisUtcDay: true,
      realizedPnlUsdc: 1,
      realizedReturnPct: 30,
    });
    const byType = Object.fromEntries(rows.map((r) => [r.event_type, r.points]));
    expect(byType.trade_executed).toBe(1);
    expect(byType.profitable_close).toBe(10);
    expect(byType.return_25_bonus).toBe(25);
    expect(byType.return_10_bonus).toBe(10);
  });

  it("does not emit profitable_close below the $0.25 floor", () => {
    const rows = buildTradeScoreRows({
      ...base,
      intentAction: "sell",
      earnsPointsThisUtcDay: true,
      realizedPnlUsdc: 0.24,
      realizedReturnPct: 50,
    });
    expect(rows.some((r) => r.event_type === "profitable_close")).toBe(false);
  });
});
