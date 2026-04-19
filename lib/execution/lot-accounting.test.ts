import { describe, expect, it } from "vitest";

import { fifoRealizedSell } from "./lot-accounting";

describe("fifoRealizedSell", () => {
  it("single-lot full close", () => {
    const r = fifoRealizedSell({
      openLotsOldestFirst: [
        { id: "lot-a", remainingQuantity: 10, avgCostUsdc: 1 },
      ],
      sellQuantity: 10,
      netProceedsUsdc: 15,
    });

    expect(r.closures).toHaveLength(1);
    expect(r.closures[0]!.lotId).toBe("lot-a");
    expect(r.closures[0]!.quantityClosed).toBe(10);
    expect(r.closures[0]!.realizedPnlUsdc).toBeCloseTo(5, 8);
    expect(r.closures[0]!.realizedReturnPct).toBeCloseTo(50, 6);
    expect(r.totalRealizedPnlUsdc).toBeCloseTo(5, 8);
    expect(r.aggregateReturnPct).toBeCloseTo(50, 6);
    expect(r.lotRemainings[0]!.remainingQuantity).toBeCloseTo(0, 8);
    expect(r.lotRemainings[0]!.closedAtIso).not.toBeNull();
  });

  it("single-lot partial close", () => {
    const r = fifoRealizedSell({
      openLotsOldestFirst: [
        { id: "lot-a", remainingQuantity: 10, avgCostUsdc: 2 },
      ],
      sellQuantity: 4,
      netProceedsUsdc: 12,
    });

    expect(r.closures).toHaveLength(1);
    expect(r.closures[0]!.quantityClosed).toBe(4);
    // exit 3 USDC/unit, cost 2 → pnl 1 per unit × 4 = 4
    expect(r.closures[0]!.realizedPnlUsdc).toBeCloseTo(4, 8);
    expect(r.lotRemainings[0]!.remainingQuantity).toBeCloseTo(6, 8);
    expect(r.lotRemainings[0]!.closedAtIso).toBeNull();
  });

  it("multi-lot partial close", () => {
    const r = fifoRealizedSell({
      openLotsOldestFirst: [
        { id: "lot-a", remainingQuantity: 10, avgCostUsdc: 1 },
        { id: "lot-b", remainingQuantity: 10, avgCostUsdc: 2 },
      ],
      sellQuantity: 15,
      netProceedsUsdc: 22.5,
    });

    expect(r.closures).toHaveLength(2);
    expect(r.closures[0]!.lotId).toBe("lot-a");
    expect(r.closures[0]!.quantityClosed).toBe(10);
    expect(r.closures[1]!.lotId).toBe("lot-b");
    expect(r.closures[1]!.quantityClosed).toBe(5);

    // exit 1.5/unit; lot-a pnl 10*(1.5-1)=5, lot-b pnl 5*(1.5-2)=-2.5
    expect(r.totalRealizedPnlUsdc).toBeCloseTo(2.5, 8);
    expect(r.totalCostBasisUsdc).toBeCloseTo(20, 8);
    expect(r.aggregateReturnPct).toBeCloseTo(12.5, 6);
  });
});
