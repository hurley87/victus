import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";

import { fifoRealizedSell } from "@/lib/execution/lot-accounting";
import { isUniqueViolation } from "@/lib/execution/reserve";

type ExecutionIntentRow = {
  id: string;
  quantity: number | null;
  execution_price_usdc: number | null;
  notional_usdc: number | null;
  swap_fee_usdc: number | null;
  sponsored_gas_usdc: number | null;
  trade_intents: {
    action: string;
    asset_symbol: string;
    wallet_id: string;
  };
};

/**
 * Idempotent FIFO bookkeeping after `decode_swap_log` populated the
 * execution row. Buys insert an `lots` row + upsert `positions`. Sells
 * consume lots FIFO, insert `lot_closures`, refresh `positions`, and
 * stamp `realized_pnl_usdc` / `realized_return_pct` on the execution.
 */
export async function applyLotsAndPositionsForExecution(
  tradeExecutionId: string,
): Promise<void> {
  const { data: row, error: readErr } = await supabaseAdmin
    .from("trade_executions")
    .select(
      `
      id,
      quantity,
      execution_price_usdc,
      notional_usdc,
      swap_fee_usdc,
      sponsored_gas_usdc,
      trade_intents ( action, asset_symbol, wallet_id )
    `,
    )
    .eq("id", tradeExecutionId)
    .maybeSingle();

  if (readErr) {
    throw new Error(`apply_lots: read trade_executions failed: ${readErr.message}`);
  }
  if (!row) throw new Error("apply_lots: trade_executions row missing");

  const joined = row as unknown as ExecutionIntentRow;
  const intent = joined.trade_intents;
  if (!intent) throw new Error("apply_lots: trade_intents join missing");

  const qty = joined.quantity;
  if (qty == null) throw new Error("apply_lots: quantity not set on execution");

  if (intent.action === "buy") {
    await applyBuyLot({
      tradeExecutionId,
      walletId: intent.wallet_id,
      symbol: intent.asset_symbol,
      quantity: Number(qty),
      swapFeeUsdc: Number(joined.swap_fee_usdc ?? 0),
      sponsoredGasUsdc: Number(joined.sponsored_gas_usdc ?? 0),
      usdcSpentOnSwap: Number(joined.notional_usdc ?? 0),
    });
    return;
  }

  if (intent.action === "sell") {
    await applySellFifo({
      tradeExecutionId,
      walletId: intent.wallet_id,
      symbol: intent.asset_symbol,
      sellQuantity: Number(qty),
      grossUsdcIn: Number(joined.notional_usdc ?? 0),
      swapFeeUsdc: Number(joined.swap_fee_usdc ?? 0),
    });
    return;
  }

  throw new Error(`apply_lots: unsupported intent action ${intent.action}`);
}

async function applyBuyLot(params: {
  tradeExecutionId: string;
  walletId: string;
  symbol: string;
  quantity: number;
  swapFeeUsdc: number;
  sponsoredGasUsdc: number;
  usdcSpentOnSwap: number;
}): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from("lots")
    .select("id")
    .eq("opening_execution_id", params.tradeExecutionId)
    .maybeSingle();

  if (existing) return;

  const totalCostUsdc =
    params.usdcSpentOnSwap + params.swapFeeUsdc + params.sponsoredGasUsdc;
  const avgCostUsdc =
    params.quantity > 0 ? totalCostUsdc / params.quantity : 0;

  const { error: lotErr } = await supabaseAdmin.from("lots").insert({
    wallet_id: params.walletId,
    asset_symbol: params.symbol,
    initial_quantity: params.quantity,
    remaining_quantity: params.quantity,
    avg_cost_usdc: avgCostUsdc,
    opening_execution_id: params.tradeExecutionId,
  });

  if (lotErr) {
    if (isUniqueViolation(lotErr)) return;
    throw new Error(`apply_lots: lots insert failed: ${lotErr.message}`);
  }

  const { data: pos, error: posReadErr } = await supabaseAdmin
    .from("positions")
    .select("quantity, avg_cost_usdc")
    .eq("wallet_id", params.walletId)
    .eq("asset_symbol", params.symbol)
    .maybeSingle();

  if (posReadErr) {
    throw new Error(`apply_lots: positions read failed: ${posReadErr.message}`);
  }

  const oldQty = pos ? Number(pos.quantity) : 0;
  const oldAvg = pos ? Number(pos.avg_cost_usdc) : 0;
  const newQty = oldQty + params.quantity;
  const newAvg =
    newQty > 0
      ? oldQty > 0
        ? (oldQty * oldAvg + params.quantity * avgCostUsdc) / newQty
        : avgCostUsdc
      : 0;

  const { error: posUpdErr } = await supabaseAdmin.from("positions").upsert(
    {
      wallet_id: params.walletId,
      asset_symbol: params.symbol,
      quantity: newQty,
      avg_cost_usdc: newAvg,
    },
    { onConflict: "wallet_id,asset_symbol" },
  );

  if (posUpdErr) {
    throw new Error(`apply_lots: positions upsert failed: ${posUpdErr.message}`);
  }
}

async function applySellFifo(params: {
  tradeExecutionId: string;
  walletId: string;
  symbol: string;
  sellQuantity: number;
  grossUsdcIn: number;
  swapFeeUsdc: number;
}): Promise<void> {
  const { data: existingClosure } = await supabaseAdmin
    .from("lot_closures")
    .select("id")
    .eq("closing_execution_id", params.tradeExecutionId)
    .limit(1)
    .maybeSingle();

  if (existingClosure) return;

  const netProceedsUsdc = params.grossUsdcIn - params.swapFeeUsdc;

  const { data: openLots, error: lotsErr } = await supabaseAdmin
    .from("lots")
    .select("id, remaining_quantity, avg_cost_usdc, opened_at")
    .eq("wallet_id", params.walletId)
    .eq("asset_symbol", params.symbol)
    .gt("remaining_quantity", 0)
    .order("opened_at", { ascending: true });

  if (lotsErr) {
    throw new Error(`apply_lots: lots fifo query failed: ${lotsErr.message}`);
  }

  const fifoInput = (openLots ?? []).map((l) => ({
    id: l.id,
    remainingQuantity: Number(l.remaining_quantity),
    avgCostUsdc: Number(l.avg_cost_usdc),
  }));

  const fifo = fifoRealizedSell({
    openLotsOldestFirst: fifoInput,
    sellQuantity: params.sellQuantity,
    netProceedsUsdc,
  });

  for (const c of fifo.closures) {
    const { error: insErr } = await supabaseAdmin.from("lot_closures").insert({
      lot_id: c.lotId,
      closing_execution_id: params.tradeExecutionId,
      quantity_closed: c.quantityClosed,
      avg_cost_usdc_at_close: c.avgCostUsdcAtClose,
      realized_pnl_usdc: c.realizedPnlUsdc,
      realized_return_pct: c.realizedReturnPct,
    });
    if (insErr && !isUniqueViolation(insErr)) {
      throw new Error(`apply_lots: lot_closures insert failed: ${insErr.message}`);
    }
  }

  for (const u of fifo.lotRemainings) {
    const { error: updErr } = await supabaseAdmin
      .from("lots")
      .update({
        remaining_quantity: u.remainingQuantity,
        closed_at: u.closedAtIso,
      })
      .eq("id", u.lotId);
    if (updErr) {
      throw new Error(`apply_lots: lots update failed: ${updErr.message}`);
    }
  }

  const { error: execErr } = await supabaseAdmin
    .from("trade_executions")
    .update({
      realized_pnl_usdc: fifo.totalRealizedPnlUsdc,
      realized_return_pct: fifo.aggregateReturnPct ?? null,
    })
    .eq("id", params.tradeExecutionId);

  if (execErr) {
    throw new Error(`apply_lots: trade_executions pnl update failed: ${execErr.message}`);
  }

  await refreshPositionFromOpenLots(params.walletId, params.symbol);
}

async function refreshPositionFromOpenLots(
  walletId: string,
  symbol: string,
): Promise<void> {
  const { data: lots, error } = await supabaseAdmin
    .from("lots")
    .select("remaining_quantity, avg_cost_usdc")
    .eq("wallet_id", walletId)
    .eq("asset_symbol", symbol)
    .gt("remaining_quantity", 0);

  if (error) {
    throw new Error(`apply_lots: lots summary query failed: ${error.message}`);
  }

  if (!lots?.length) {
    const { error: delErr } = await supabaseAdmin
      .from("positions")
      .delete()
      .eq("wallet_id", walletId)
      .eq("asset_symbol", symbol);
    if (delErr) {
      throw new Error(`apply_lots: positions delete failed: ${delErr.message}`);
    }
    return;
  }

  let qtySum = 0;
  let costSum = 0;
  for (const l of lots) {
    const rem = Number(l.remaining_quantity);
    const avg = Number(l.avg_cost_usdc);
    qtySum += rem;
    costSum += rem * avg;
  }

  const avgCost = qtySum > 0 ? costSum / qtySum : 0;

  const { error: upErr } = await supabaseAdmin.from("positions").upsert(
    {
      wallet_id: walletId,
      asset_symbol: symbol,
      quantity: qtySum,
      avg_cost_usdc: avgCost,
    },
    { onConflict: "wallet_id,asset_symbol" },
  );

  if (upErr) {
    throw new Error(`apply_lots: positions refresh upsert failed: ${upErr.message}`);
  }
}
