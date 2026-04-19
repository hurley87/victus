/**
 * FIFO lot consumption for sell executions — pure helpers so Vitest can
 * pin single-lot / multi-lot scenarios without a database.
 */

export type OpenLotForFifo = {
  id: string;
  remainingQuantity: number;
  avgCostUsdc: number;
};

export type FifoLotClosureDraft = {
  lotId: string;
  quantityClosed: number;
  avgCostUsdcAtClose: number;
  realizedPnlUsdc: number;
  realizedReturnPct: number;
};

export type FifoLotRemainingDraft = {
  lotId: string;
  remainingQuantity: number;
  /** ISO timestamp when the lot is fully closed; null if still open. */
  closedAtIso: string | null;
};

export type FifoSellResult = {
  closures: FifoLotClosureDraft[];
  lotRemainings: FifoLotRemainingDraft[];
  totalCostBasisUsdc: number;
  totalRealizedPnlUsdc: number;
  /** Aggregate return vs cost of closed pieces; null if no cost. */
  aggregateReturnPct: number | null;
};

const QTY_EPS = 1e-12;

/**
 * Consumes open lots oldest-first until `sellQuantity` units are matched.
 * Proceeds are allocated at a uniform exit price `netProceedsUsdc / sellQuantity`
 * so per-lot PnL partitions sum to the portfolio-level PnL.
 */
export function fifoRealizedSell(args: {
  openLotsOldestFirst: OpenLotForFifo[];
  sellQuantity: number;
  netProceedsUsdc: number;
}): FifoSellResult {
  const { openLotsOldestFirst, sellQuantity, netProceedsUsdc } = args;

  if (!(sellQuantity > QTY_EPS)) {
    throw new Error("fifoRealizedSell: sellQuantity must be positive");
  }
  if (!Number.isFinite(netProceedsUsdc)) {
    throw new Error("fifoRealizedSell: netProceedsUsdc must be finite");
  }

  const exitPriceUsdcPerUnit = netProceedsUsdc / sellQuantity;
  let remainingToSell = sellQuantity;
  const closures: FifoLotClosureDraft[] = [];
  const lotRemainings: FifoLotRemainingDraft[] = [];
  let totalCostBasisUsdc = 0;
  let totalRealizedPnlUsdc = 0;
  const nowIso = new Date().toISOString();

  for (const lot of openLotsOldestFirst) {
    if (remainingToSell <= QTY_EPS) break;
    if (!(lot.remainingQuantity > QTY_EPS)) continue;

    const take = Math.min(lot.remainingQuantity, remainingToSell);
    const costPortion = take * lot.avgCostUsdc;
    const proceedsPortion = take * exitPriceUsdcPerUnit;
    const realizedPnlUsdc = proceedsPortion - costPortion;
    const realizedReturnPct =
      costPortion > QTY_EPS ? (realizedPnlUsdc / costPortion) * 100 : 0;

    closures.push({
      lotId: lot.id,
      quantityClosed: take,
      avgCostUsdcAtClose: lot.avgCostUsdc,
      realizedPnlUsdc,
      realizedReturnPct,
    });

    totalCostBasisUsdc += costPortion;
    totalRealizedPnlUsdc += realizedPnlUsdc;

    const newRemaining = lot.remainingQuantity - take;
    lotRemainings.push({
      lotId: lot.id,
      remainingQuantity: newRemaining,
      closedAtIso: newRemaining <= QTY_EPS ? nowIso : null,
    });

    remainingToSell -= take;
  }

  if (remainingToSell > QTY_EPS) {
    throw new Error("fifoRealizedSell: insufficient open lot quantity");
  }

  const aggregateReturnPct =
    totalCostBasisUsdc > QTY_EPS
      ? (totalRealizedPnlUsdc / totalCostBasisUsdc) * 100
      : null;

  return {
    closures,
    lotRemainings,
    totalCostBasisUsdc,
    totalRealizedPnlUsdc,
    aggregateReturnPct,
  };
}
