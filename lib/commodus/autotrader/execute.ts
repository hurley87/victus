import "server-only";

import { formatUnits, getAddress, parseUnits, type Hex } from "viem";

import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import { basePublicClient } from "@/lib/chain/client";
import { env } from "@/lib/env";
import { ensureErc20Allowance, ensureUsdcAllowance } from "@/lib/execution/allowance";
import { submitFeeTransfer, OperatorTreasuryNotConfiguredError } from "@/lib/execution/fee-transfer";
import { computeSwapFeeUsdc } from "@/lib/execution/fees";
import { deriveExecutionId } from "@/lib/execution/ids";
import type { PolicyContext } from "@/lib/execution/policy";
import { reserveOrLoadExecution, type ReservedExecution } from "@/lib/execution/reserve";
import { applyLotsAndPositionsForExecution } from "@/lib/execution/lot-persistence";
import {
  decodeSwapReceipt,
  findDisallowedWalletTokens,
  SwapLogMissingError,
  type SwapDirection,
} from "@/lib/execution/swap-logs";
import { getAllowanceHolderQuote, ZeroxNotConfiguredError, type AllowanceHolderQuote } from "@/lib/zerox/quote";
import { supabaseAdmin } from "@/lib/supabase/server";
import { log } from "@/lib/logger";
import {
  PrivyTransactionFailedError,
  PrivyTransactionTimeoutError,
  signAndSendTransaction,
  waitForTransaction,
} from "@/lib/privy/server";
import type { SellIntent, TradeIntent } from "@/lib/execution/intents";

const DECODE_TOLERANCE_BPS = 10;

type QuoteAndReserveReturn = ReservedExecution & {
  executionId: string;
  txTo: string;
  txData: string;
  txValue: string;
  sellAmountBaseUnits: string;
  reservedFillUsdc: number;
  feeUsdc: number;
};

export type CommodusExecuteResult =
  | {
      ok: true;
      tradeExecutionId: string;
      txHash: string;
      notionalUsdc: number;
      action: "buy" | "sell";
      symbol: string;
    }
  | { ok: false; reason: string; tradeExecutionId?: string };

type DecodeSwapLogResult =
  | {
      ok: true;
      quantity: number;
      executionPriceUsdc: number;
      fillUsdcHuman: number;
    }
  | { ok: false; reason: "decode_log_missing" | "decode_log_mismatch" | "non_whitelisted_token" };

function throwIfZeroxMissing(err: unknown): void {
  if (err instanceof ZeroxNotConfiguredError) {
    throw err;
  }
}

export async function executeCommodusAutotrade(params: {
  castHash: string;
  castCommandId: string;
  userId: string;
  policyCtx: PolicyContext;
  intent: TradeIntent;
}): Promise<CommodusExecuteResult> {
  const { castHash, castCommandId, userId, policyCtx } = params;
  const intent = params.intent;

  if (intent.action === "sell") {
    return await runSellPath({
      castHash,
      castCommandId,
      userId,
      policyCtx,
      sellIntent: intent,
    });
  }

  return await runBuyPath({
    castHash,
    castCommandId,
    userId,
    policyCtx,
    intent,
  });
}

async function runBuyPath(params: {
  castHash: string;
  castCommandId: string;
  userId: string;
  policyCtx: PolicyContext;
  intent: TradeIntent;
}): Promise<CommodusExecuteResult> {
  const { castHash, castCommandId, userId, policyCtx, intent } = params;

  const feeUsdc = computeSwapFeeUsdc({
    notionalUsdc: intent.amount_value,
    swapFeeBps: policyCtx.policy.swapFeeBps,
    swapFeeMinUsdc: policyCtx.policy.swapFeeMinUsdc,
  });
  const netNotional = Math.max(intent.amount_value - feeUsdc, 0);
  if (netNotional <= 0) {
    return { ok: false, reason: "fee_exceeds_notional" };
  }

  let reservation: QuoteAndReserveReturn;
  try {
    reservation = await quoteAndReserve({
      castHash,
      castCommandId,
      ctx: policyCtx,
      intent,
      feeUsdc,
      netNotional,
    });
  } catch (err) {
    throwIfZeroxMissing(err);
    return { ok: false, reason: err instanceof Error ? err.message : "quote_failed" };
  }

  const executionId = reservation.executionId;
  const tradeExecutionId = reservation.tradeExecutionId;

  await markStatus(castHash, "quoted");
  try {
    await ensureUsdcAllowance({
      walletAddress: policyCtx.walletAddress,
      privyWalletId: policyCtx.privyWalletId,
      spender: reservation.txTo,
      minRequired: BigInt(reservation.sellAmountBaseUnits),
      referenceId: executionId,
    });
  } catch (err) {
    log.error("commodus_autotrade_allowance_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "allowance_failed", tradeExecutionId };
  }

  const submitted: { txHash: string; privyTransactionId: string } =
    reservation.txHash
      ? { txHash: reservation.txHash, privyTransactionId: reservation.privyTransactionId ?? "" }
      : await submitSwap({
          castHash,
          executionId,
          tradeExecutionId,
          policyCtx,
          txTo: reservation.txTo,
          txData: reservation.txData,
          txValue: reservation.txValue,
        });

  await markStatus(castHash, "executing");

  const confirmed = reservation.confirmedAt
    ? { txHash: submitted.txHash, confirmedAt: reservation.confirmedAt }
    : await verifyTxOnchain({ tradeExecutionId, txHash: submitted.txHash });

  const decoded = await decodeSwapLog({
    castHash,
    tradeExecutionId,
    txHash: confirmed.txHash,
    walletAddress: policyCtx.walletAddress,
    assetAddress: policyCtx.assetAddress,
    assetDecimals: policyCtx.assetDecimals,
    reservedFillUsdc: reservation.reservedFillUsdc,
    direction: "usdc_to_asset",
  });
  if (!decoded.ok) {
    await markTradeExecutionFailed(tradeExecutionId, decoded.reason);
    await markRejected(castHash, decoded.reason, "failed");
    return { ok: false, reason: decoded.reason, tradeExecutionId };
  }

  try {
    await transferFee({
      castHash,
      tradeExecutionId,
      privyWalletId: policyCtx.privyWalletId,
      feeUsdc: reservation.feeUsdc,
      executionId,
    });
  } catch (err) {
    if (err instanceof OperatorTreasuryNotConfiguredError) {
      return { ok: false, reason: "operator_treasury_not_configured", tradeExecutionId };
    }
  }

  const enforcement = await scoreTimeEnforcement({
    tradeExecutionId,
    policyCtx,
  });
  if (!enforcement.ok) {
    await markTradeExecutionFailed(tradeExecutionId, enforcement.reason);
    await markRejected(castHash, enforcement.reason, "failed");
    return { ok: false, reason: enforcement.reason, tradeExecutionId };
  }

  await applyLotsAndPositionsForExecution(tradeExecutionId);

  await markStatus(castHash, "executed");
  return {
    ok: true,
    tradeExecutionId,
    txHash: confirmed.txHash,
    notionalUsdc: decoded.fillUsdcHuman,
    action: "buy",
    symbol: intent.symbol,
  };
}

async function runSellPath(params: {
  castHash: string;
  castCommandId: string;
  userId: string;
  policyCtx: PolicyContext;
  sellIntent: SellIntent;
}): Promise<CommodusExecuteResult> {
  const { castHash, castCommandId, userId, policyCtx, sellIntent } = params;

  const sellAssetBaseUnits = policyCtx.sellAssetBaseUnits;
  if (!sellAssetBaseUnits) {
    return { ok: false, reason: "sellAssetBaseUnits_missing" };
  }

  let reservation: QuoteAndReserveReturn;
  try {
    reservation = await quoteAndReserveSell({
      castHash,
      castCommandId,
      ctx: policyCtx,
      intent: sellIntent,
      sellAssetBaseUnits,
    });
  } catch (err) {
    throwIfZeroxMissing(err);
    return { ok: false, reason: err instanceof Error ? err.message : "quote_failed" };
  }

  if (reservation.reservedFillUsdc <= reservation.feeUsdc) {
    await markRejected(castHash, "max_trade_usdc", "rejected");
    return { ok: false, reason: "fee_exceeds_notional" };
  }

  const tradeExecutionId = reservation.tradeExecutionId;
  const executionId = reservation.executionId;

  await markStatus(castHash, "quoted");
  try {
    await ensureErc20Allowance({
      tokenAddress: policyCtx.assetAddress,
      walletAddress: policyCtx.walletAddress,
      privyWalletId: policyCtx.privyWalletId,
      spender: reservation.txTo,
      minRequired: BigInt(sellAssetBaseUnits),
      referenceId: executionId,
    });
  } catch (err) {
    log.error("commodus_autotrade_sell_allowance_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "allowance_failed", tradeExecutionId };
  }

  const submitted: { txHash: string; privyTransactionId: string } =
    reservation.txHash
      ? { txHash: reservation.txHash, privyTransactionId: reservation.privyTransactionId ?? "" }
      : await submitSwap({
          castHash,
          executionId,
          tradeExecutionId,
          policyCtx,
          txTo: reservation.txTo,
          txData: reservation.txData,
          txValue: reservation.txValue,
        });

  await markStatus(castHash, "executing");

  const confirmed = reservation.confirmedAt
    ? { txHash: submitted.txHash, confirmedAt: reservation.confirmedAt }
    : await verifyTxOnchain({ tradeExecutionId, txHash: submitted.txHash });

  const decoded = await decodeSwapLog({
    castHash,
    tradeExecutionId,
    txHash: confirmed.txHash,
    walletAddress: policyCtx.walletAddress,
    assetAddress: policyCtx.assetAddress,
    assetDecimals: policyCtx.assetDecimals,
    reservedFillUsdc: reservation.reservedFillUsdc,
    direction: "asset_to_usdc",
  });
  if (!decoded.ok) {
    await markTradeExecutionFailed(tradeExecutionId, decoded.reason);
    await markRejected(castHash, decoded.reason, "failed");
    return { ok: false, reason: decoded.reason, tradeExecutionId };
  }

  try {
    await transferFee({
      castHash,
      tradeExecutionId,
      privyWalletId: policyCtx.privyWalletId,
      feeUsdc: reservation.feeUsdc,
      executionId,
    });
  } catch (err) {
    if (err instanceof OperatorTreasuryNotConfiguredError) {
      return { ok: false, reason: "operator_treasury_not_configured", tradeExecutionId };
    }
  }

  const enforcement = await scoreTimeEnforcement({ tradeExecutionId, policyCtx });
  if (!enforcement.ok) {
    await markTradeExecutionFailed(tradeExecutionId, enforcement.reason);
    await markRejected(castHash, enforcement.reason, "failed");
    return { ok: false, reason: enforcement.reason, tradeExecutionId };
  }

  await applyLotsAndPositionsForExecution(tradeExecutionId);

  await markStatus(castHash, "executed");
  return {
    ok: true,
    tradeExecutionId,
    txHash: confirmed.txHash,
    notionalUsdc: reservation.reservedFillUsdc,
    action: "sell",
    symbol: sellIntent.symbol,
  };
}

// ---------------------------------------------------------------------------
// Internals (mirrors `lib/workflows/commodus-command.ts` without reply casts)
// ---------------------------------------------------------------------------

async function quoteAndReserve(params: {
  castHash: string;
  castCommandId: string;
  ctx: PolicyContext;
  intent: TradeIntent;
  feeUsdc: number;
  netNotional: number;
}): Promise<QuoteAndReserveReturn> {
  const executionId = deriveExecutionId(params.castHash);
  const sellAmount = parseUnits(
    params.netNotional.toFixed(USDC_DECIMALS),
    USDC_DECIMALS,
  );

  let quote;
  try {
    quote = await getAllowanceHolderQuote({
      sellToken: USDC_BASE_ADDRESS,
      buyToken: params.ctx.assetAddress,
      sellAmount: sellAmount.toString(),
      taker: params.ctx.walletAddress,
      slippageBps: params.ctx.policy.maxSlippageBps,
    });
  } catch (err) {
    throwIfZeroxMissing(err);
    throw err;
  }
  if (!quote.liquidityAvailable) {
    throw new Error("0x: no liquidity for buy pair");
  }
  const reservation = await reserveOrLoadExecution({
    castCommandId: params.castCommandId,
    ctx: params.ctx,
    intent: params.intent,
    executionId,
    feeUsdc: params.feeUsdc,
    notionalUsdc: params.netNotional,
  });
  return {
    ...reservation,
    executionId,
    txTo: quote.transaction.to,
    txData: quote.transaction.data,
    txValue: quote.transaction.value,
    sellAmountBaseUnits: sellAmount.toString(),
    reservedFillUsdc: params.netNotional,
    feeUsdc: params.feeUsdc,
  };
}

async function quoteAndReserveSell(params: {
  castHash: string;
  castCommandId: string;
  ctx: PolicyContext;
  intent: SellIntent;
  sellAssetBaseUnits: string;
}): Promise<QuoteAndReserveReturn> {
  const executionId = deriveExecutionId(params.castHash);
  let quote;
  try {
    quote = await getAllowanceHolderQuote({
      sellToken: params.ctx.assetAddress,
      buyToken: USDC_BASE_ADDRESS,
      sellAmount: params.sellAssetBaseUnits,
      taker: params.ctx.walletAddress,
      slippageBps: params.ctx.policy.maxSlippageBps,
    });
  } catch (err) {
    throwIfZeroxMissing(err);
    throw err;
  }
  if (!quote.liquidityAvailable) {
    throw new Error("0x: no liquidity for sell pair");
  }
  const grossUsdcExpected = Number(formatUnits(BigInt(quote.buyAmount), USDC_DECIMALS));
  const feeUsdc = computeSwapFeeUsdc({
    notionalUsdc: grossUsdcExpected,
    swapFeeBps: params.ctx.policy.swapFeeBps,
    swapFeeMinUsdc: params.ctx.policy.swapFeeMinUsdc,
  });
  const reservation = await reserveOrLoadExecution({
    castCommandId: params.castCommandId,
    ctx: params.ctx,
    intent: params.intent,
    executionId,
    feeUsdc,
    notionalUsdc: grossUsdcExpected,
  });
  return {
    ...reservation,
    executionId,
    txTo: quote.transaction.to,
    txData: quote.transaction.data,
    txValue: quote.transaction.value,
    sellAmountBaseUnits: params.sellAssetBaseUnits,
    reservedFillUsdc: grossUsdcExpected,
    feeUsdc,
  };
}

async function submitSwap(params: {
  castHash: string;
  executionId: string;
  tradeExecutionId: string;
  policyCtx: PolicyContext;
  txTo: string;
  txData: string;
  txValue: string;
}): Promise<{ txHash: string; privyTransactionId: string }> {
  const value =
    params.txValue && params.txValue !== "0"
      ? `0x${BigInt(params.txValue).toString(16)}`
      : undefined;
  const result = await signAndSendTransaction({
    walletId: params.policyCtx.privyWalletId,
    to: params.txTo,
    data: params.txData,
    value,
    sponsor: env.PRIVY_SPONSOR_GAS,
    referenceId: params.executionId,
  });
  let finalHash = result.hash;
  if (!finalHash) {
    try {
      const { hash } = await waitForTransaction(result.transactionId, { timeoutMs: 30_000 });
      finalHash = hash;
    } catch (err) {
      if (err instanceof PrivyTransactionTimeoutError || err instanceof PrivyTransactionFailedError) {
        await supabaseAdmin
          .from("trade_executions")
          .update({ privy_transaction_id: result.transactionId, status: "submitted" })
          .eq("id", params.tradeExecutionId);
      }
      throw err;
    }
  }
  const { error } = await supabaseAdmin
    .from("trade_executions")
    .update({
      tx_hash: finalHash,
      privy_transaction_id: result.transactionId,
      status: "submitted",
    })
    .eq("id", params.tradeExecutionId);
  if (error) {
    throw new Error(`submit_swap: ${error.message}`);
  }
  return { txHash: finalHash, privyTransactionId: result.transactionId };
}

async function transferFee(params: {
  castHash: string;
  tradeExecutionId: string;
  privyWalletId: string;
  feeUsdc: number;
  executionId: string;
}): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("trade_executions")
    .select("fee_tx_hash")
    .eq("id", params.tradeExecutionId)
    .maybeSingle();
  if (row?.fee_tx_hash) return;

  try {
    const result = await submitFeeTransfer({
      walletId: params.privyWalletId,
      feeUsdc: params.feeUsdc,
      referenceId: `${params.executionId}:fee`,
    });
    let hash = result.hash;
    if (!hash) {
      const { hash: w } = await waitForTransaction(result.transactionId, { timeoutMs: 15_000 });
      hash = w;
    }
    await supabaseAdmin.from("trade_executions").update({ fee_tx_hash: hash }).eq("id", params.tradeExecutionId);
  } catch (err) {
    if (err instanceof OperatorTreasuryNotConfiguredError) {
      throw err;
    }
    log.error("commodus_autotrade_transfer_fee_failed", {
      castHash: params.castHash,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function verifyTxOnchain(params: {
  tradeExecutionId: string;
  txHash: string;
}): Promise<{ txHash: string; confirmedAt: string }> {
  const receipt = await basePublicClient.waitForTransactionReceipt({
    hash: params.txHash as Hex,
    confirmations: 1,
    timeout: 30_000,
  });
  if (receipt.status !== "success") {
    await supabaseAdmin
      .from("trade_executions")
      .update({ status: "reverted", failure_reason: "revert" })
      .eq("id", params.tradeExecutionId);
    throw new Error(`tx reverted: ${params.txHash}`);
  }
  const confirmedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("trade_executions")
    .update({ status: "confirmed", confirmed_at: confirmedAt })
    .eq("id", params.tradeExecutionId);
  if (error) {
    throw new Error(`verify_tx: ${error.message}`);
  }
  return { txHash: params.txHash, confirmedAt };
}

async function decodeSwapLog(params: {
  castHash: string;
  tradeExecutionId: string;
  txHash: string;
  walletAddress: string;
  assetAddress: string;
  assetDecimals: number;
  reservedFillUsdc: number;
  direction: SwapDirection;
}): Promise<DecodeSwapLogResult> {
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("trade_executions")
    .select("quantity, execution_price_usdc, notional_usdc")
    .eq("id", params.tradeExecutionId)
    .maybeSingle();
  if (readErr) {
    throw new Error(`decode: read failed: ${readErr.message}`);
  }
  if (existing?.quantity != null && existing?.execution_price_usdc != null) {
    const fillUsdcHuman =
      existing.notional_usdc != null
        ? Number(existing.notional_usdc)
        : params.reservedFillUsdc;
    return {
      ok: true,
      quantity: Number(existing.quantity),
      executionPriceUsdc: Number(existing.execution_price_usdc),
      fillUsdcHuman,
    };
  }
  const receipt = await basePublicClient.getTransactionReceipt({ hash: params.txHash as Hex });
  let decoded;
  try {
    decoded = decodeSwapReceipt(receipt, {
      walletAddress: params.walletAddress,
      assetAddress: params.assetAddress,
      assetDecimals: params.assetDecimals,
      direction: params.direction,
    });
  } catch (err) {
    if (err instanceof SwapLogMissingError) {
      return { ok: false, reason: "decode_log_missing" };
    }
    throw err;
  }
  const rogue = findDisallowedWalletTokens(
    receipt,
    params.walletAddress,
    getAddress(params.assetAddress),
  );
  if (rogue.length > 0) {
    return { ok: false, reason: "non_whitelisted_token" };
  }
  const tolerance = (params.reservedFillUsdc * DECODE_TOLERANCE_BPS) / 10_000;
  if (Math.abs(decoded.usdcHumanNumber - params.reservedFillUsdc) > tolerance) {
    return { ok: false, reason: "decode_log_mismatch" };
  }
  const { error: updErr } = await supabaseAdmin
    .from("trade_executions")
    .update({
      quantity: decoded.quantity as unknown as number,
      execution_price_usdc: decoded.executionPriceUsdc as unknown as number,
      notional_usdc: decoded.usdcHumanNumber as unknown as number,
    })
    .eq("id", params.tradeExecutionId);
  if (updErr) {
    throw new Error(`decode: update failed: ${updErr.message}`);
  }
  return {
    ok: true,
    quantity: decoded.quantityNumber,
    executionPriceUsdc: decoded.executionPriceUsdcNumber,
    fillUsdcHuman: decoded.usdcHumanNumber,
  };
}

function quantityFieldToParseString(q: number | string, fractionDigits: number) {
  if (typeof q === "number") {
    return q.toFixed(fractionDigits);
  }
  return String(q).trim();
}

async function fetchReferenceZeroxQuoteForImpactCheck(params: {
  intentAction: "buy" | "sell";
  assetAddress: `0x${string}`;
  assetDecimals: number;
  quantity: number | string | null;
  notionalUsdc: number | string | null;
  taker: `0x${string}`;
  slippageBps: number;
  blockNumber: bigint;
}): Promise<AllowanceHolderQuote> {
  const errors: string[] = [];
  for (const delta of [BigInt(0), BigInt(1), BigInt(-1)]) {
    const bn = params.blockNumber + delta;
    if (bn < BigInt(0)) continue;
    try {
      if (params.intentAction === "buy") {
        const usdcHuman = Number(params.notionalUsdc ?? 0);
        const sellWei = parseUnits(usdcHuman.toFixed(USDC_DECIMALS), USDC_DECIMALS);
        return await getAllowanceHolderQuote({
          sellToken: USDC_BASE_ADDRESS,
          buyToken: params.assetAddress,
          sellAmount: sellWei.toString(),
          taker: params.taker,
          slippageBps: params.slippageBps,
          blockNumber: bn,
        });
      }
      const qtyStr = quantityFieldToParseString(params.quantity ?? "0", params.assetDecimals);
      const sellWei = parseUnits(qtyStr, params.assetDecimals);
      return await getAllowanceHolderQuote({
        sellToken: params.assetAddress,
        buyToken: USDC_BASE_ADDRESS,
        sellAmount: sellWei.toString(),
        taker: params.taker,
        slippageBps: params.slippageBps,
        blockNumber: bn,
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`reference 0x quote failed: ${errors.join(" | ")}`);
}

async function scoreTimeEnforcement(params: {
  tradeExecutionId: string;
  policyCtx: PolicyContext;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: row, error: rowErr } = await supabaseAdmin
    .from("trade_executions")
    .select("status, failure_reason, tx_hash, quantity, notional_usdc, trade_intents!inner(action)")
    .eq("id", params.tradeExecutionId)
    .single();
  if (rowErr || !row) {
    throw new Error(`scoreTimeEnforcement: load failed: ${rowErr?.message}`);
  }
  if (row.status === "failed" && row.failure_reason === "price_impact") {
    return { ok: false, reason: "price_impact" };
  }
  const intent = row.trade_intents as { action: string };
  if (row.quantity == null || row.notional_usdc == null || !row.tx_hash) {
    return { ok: true };
  }
  if (intent.action !== "buy" && intent.action !== "sell") {
    return { ok: true };
  }
  const receipt = await basePublicClient.getTransactionReceipt({ hash: row.tx_hash as Hex });
  let ref: AllowanceHolderQuote;
  try {
    ref = await fetchReferenceZeroxQuoteForImpactCheck({
      intentAction: intent.action,
      assetAddress: params.policyCtx.assetAddress,
      assetDecimals: params.policyCtx.assetDecimals,
      quantity: row.quantity,
      notionalUsdc: row.notional_usdc,
      taker: params.policyCtx.walletAddress,
      slippageBps: params.policyCtx.policy.maxSlippageBps,
      blockNumber: receipt.blockNumber,
    });
  } catch {
    return { ok: true };
  }
  if (!ref.liquidityAvailable) return { ok: true };
  const refOutWei = BigInt(ref.buyAmount);
  if (refOutWei === BigInt(0)) return { ok: true };
  let actualOutWei: bigint;
  if (intent.action === "buy") {
    const qtyStr = quantityFieldToParseString(
      row.quantity,
      params.policyCtx.assetDecimals,
    );
    actualOutWei = parseUnits(qtyStr, params.policyCtx.assetDecimals);
  } else {
    const usdcHuman = Number(row.notional_usdc);
    actualOutWei = parseUnits(usdcHuman.toFixed(USDC_DECIMALS), USDC_DECIMALS);
  }
  const diff =
    actualOutWei > refOutWei ? actualOutWei - refOutWei : refOutWei - actualOutWei;
  const impactBps = Number((diff * BigInt(10_000)) / refOutWei);
  if (impactBps > params.policyCtx.policy.maxPriceImpactBps) {
    return { ok: false, reason: "price_impact" };
  }
  return { ok: true };
}

async function markStatus(castHash: string, status: string): Promise<void> {
  await supabaseAdmin
    .from("cast_commands")
    .update({ status })
    .eq("cast_hash", castHash)
    .not("status", "in", "(executed,failed,rejected)");
}

async function markRejected(
  castHash: string,
  reason: string,
  terminal: "rejected" | "failed" = "rejected",
): Promise<void> {
  await supabaseAdmin
    .from("cast_commands")
    .update({ status: terminal, error_reason: reason })
    .eq("cast_hash", castHash)
    .not("status", "in", "(executed,failed,rejected)");
}

async function markTradeExecutionFailed(
  tradeExecutionId: string,
  failureReason: string,
): Promise<void> {
  await supabaseAdmin
    .from("trade_executions")
    .update({ status: "failed", failure_reason: failureReason })
    .eq("id", tradeExecutionId);
}
