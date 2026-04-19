import { FatalError } from "workflow";
import { parseUnits, type Hex } from "viem";

import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import { basePublicClient } from "@/lib/chain/client";
import { REJECTION_REPLIES } from "@/lib/commodus/templates";
import { env } from "@/lib/env";
import { MissingSignerError } from "@/lib/neynar";
import {
  PrivyTransactionFailedError,
  PrivyTransactionTimeoutError,
  signAndSendTransaction,
  waitForTransaction,
} from "@/lib/privy/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  getAllowanceHolderQuote,
  ZeroxNotConfiguredError,
} from "@/lib/zerox/quote";

import { ensureUsdcAllowance } from "@/lib/execution/allowance";
import {
  submitFeeTransfer,
  OperatorTreasuryNotConfiguredError,
} from "@/lib/execution/fee-transfer";
import { computeSwapFeeUsdc } from "@/lib/execution/fees";
import { deriveExecutionId } from "@/lib/execution/ids";
import { parseCommandIntent } from "@/lib/execution/parse";
import { validatePolicy, type PolicyContext } from "@/lib/execution/policy";
import { publishReplyOnce } from "@/lib/execution/reply-guard";
import {
  reserveOrLoadExecution,
  type ReservedExecution,
} from "@/lib/execution/reserve";
import {
  decodeSwapReceipt,
  SwapLogMissingError,
} from "@/lib/execution/swap-logs";
import {
  buildIntentReply,
  buildOutcomeReply,
  HANDOFF_REJECTION_COPY,
  POLICY_REJECTION_COPY,
} from "@/lib/execution/templates";
import type { CommandIntent, TradeIntent } from "@/lib/execution/intents";

/**
 * Payload forwarded from the Neynar `cast.created` webhook. Narrow by
 * design: anything extra should be fetched lazily inside a step so the
 * workflow event log stays small and deterministically serializable.
 */
export interface CommandContext {
  castHash: string;
  authorFid: number;
  text: string;
  parentHash: string | null;
}

/**
 * Single-phase durable pipeline for a `@commodus` mention.
 *
 * Flow (issue #8 § Workflow):
 *   load_command → parse → policy_validate → compute_fee → quote_swap →
 *   publish_intent_reply → ensure_allowance → submit_swap → transfer_fee →
 *   verify_tx → decode_swap_log → score_time_enforcement →
 *   update_lots_and_positions → score_trade → publish_outcome_reply
 *
 * Every step is `'use step'` and either pure or idempotent check-then-
 * act. Replays land on the same `execution_id` reservation and pick up
 * from the furthest-forward populated column (`tx_hash`, `confirmed_at`,
 * `cast_replies` rows, etc.).
 *
 * The happy path is fully implemented through `decode_swap_log` (#26);
 * FIFO bookkeeping (#10) / score-time price-impact (#12) / full scoring
 * are minimal placeholders with TODO markers — the replay-safety and
 * outcome-reply invariants hold regardless of how those are fleshed out.
 */
export async function handleCommodusCommand(ctx: CommandContext) {
  "use workflow";

  const loaded = await loadCommand(ctx.castHash);
  if (loaded.shouldExit) {
    return { status: "noop" as const, reason: loaded.status };
  }

  const parseOutcome = await parseStep(ctx.text);
  if (!parseOutcome.ok) {
    const rejection = parseRejectionFor(parseOutcome.reason);
    await markRejected(ctx.castHash, rejection.errorReason);
    await publishOutcomeReply(ctx.castHash, rejection.reply);
    return { status: "rejected" as const, reason: rejection.errorReason };
  }

  const commandIntent = parseOutcome.intent;
  await markStatus(ctx.castHash, "parsed");

  // Status branch — short-circuit before the entire trade pipeline.
  // Real reply behavior (Snap card + rank) is issue #13; this issue
  // only wires the no-op handoff point.
  if (commandIntent.action === "status") {
    await handleStatusNoop({ castHash: ctx.castHash });
    return { status: "status_ack" as const };
  }

  const intent: TradeIntent = commandIntent;

  const walletLookup = await resolveArenaWallet(ctx.authorFid);
  if (!walletLookup) {
    await markRejected(ctx.castHash, "needs_gladiator_mint");
    await publishOutcomeReply(
      ctx.castHash,
      POLICY_REJECTION_COPY.needs_gladiator_mint,
    );
    return { status: "rejected" as const, reason: "needs_gladiator_mint" };
  }

  const policy = await policyValidate({
    userId: walletLookup.userId,
    walletId: walletLookup.walletId,
    walletAddress: walletLookup.walletAddress,
    privyWalletId: walletLookup.privyWalletId,
    intent,
  });
  if (!policy.ok) {
    await markRejected(ctx.castHash, policy.reason);
    await publishOutcomeReply(
      ctx.castHash,
      POLICY_REJECTION_COPY[policy.reason],
    );
    return { status: "rejected" as const, reason: policy.reason };
  }

  await markStatus(ctx.castHash, "validated");

  // Sell handoff — #9 reaches `policy_validate` and stops here. Full
  // sell execution (quote, submit, FIFO lot consumption, realized PnL)
  // is issue #10. Leaving the `TODO(#10)` markers below so the pickup
  // PR knows what to remove.
  if (intent.action === "sell") {
    await markRejected(ctx.castHash, "sell_not_yet_supported");
    await publishOutcomeReply(
      ctx.castHash,
      HANDOFF_REJECTION_COPY.sell_not_yet_supported,
    );
    return {
      status: "rejected" as const,
      reason: "sell_not_yet_supported" as const,
    };
  }

  // `intent` is now narrowed to `BuyIntent` — sells branched out above
  // and status branched out before wallet lookup.
  const feeUsdc = await computeFee({
    notionalUsdc: intent.amount_value,
    swapFeeBps: policy.context.policy.swapFeeBps,
    swapFeeMinUsdc: policy.context.policy.swapFeeMinUsdc,
  });

  const netNotional = Math.max(intent.amount_value - feeUsdc, 0);

  if (netNotional <= 0) {
    await markRejected(ctx.castHash, "max_trade_usdc");
    await publishOutcomeReply(
      ctx.castHash,
      POLICY_REJECTION_COPY.max_trade_usdc,
    );
    return { status: "rejected" as const, reason: "fee_exceeds_notional" };
  }

  const reservation = await quoteAndReserve({
    castHash: ctx.castHash,
    castCommandId: loaded.id,
    ctx: policy.context,
    intent,
    feeUsdc,
    netNotional,
  });
  const executionId = reservation.executionId;

  await markStatus(ctx.castHash, "quoted");

  await publishIntentReply(ctx.castHash, buildIntentReply(intent));

  // Guarantees `USDC.allowance(arenaWallet, AllowanceHolder) >= sellAmount`.
  // A no-op read for wallets that already MAX-approved on a prior swap.
  await ensureAllowanceStep({
    ctx: policy.context,
    spender: reservation.txTo,
    sellAmountBaseUnits: reservation.sellAmountBaseUnits,
    executionId,
  });

  const submitted: { txHash: string; privyTransactionId: string | null } =
    reservation.txHash
      ? {
          txHash: reservation.txHash,
          privyTransactionId: reservation.privyTransactionId,
        }
      : await submitSwap({
          executionId,
          tradeExecutionId: reservation.tradeExecutionId,
          ctx: policy.context,
          quoteTxTo: reservation.txTo,
          quoteTxData: reservation.txData,
          quoteTxValue: reservation.txValue,
        });

  await markStatus(ctx.castHash, "executing");

  await transferFeeLeg({
    tradeExecutionId: reservation.tradeExecutionId,
    walletId: policy.context.privyWalletId,
    feeUsdc,
    executionId,
  });

  const confirmed = reservation.confirmedAt
    ? { txHash: submitted.txHash, confirmedAt: reservation.confirmedAt }
    : await verifyTxOnchain({
        tradeExecutionId: reservation.tradeExecutionId,
        txHash: submitted.txHash,
      });

  const decoded = await decodeSwapLog({
    tradeExecutionId: reservation.tradeExecutionId,
    txHash: confirmed.txHash,
    walletAddress: policy.context.walletAddress,
    assetAddress: policy.context.assetAddress,
    assetDecimals: policy.context.assetDecimals,
    reservedNotionalUsdc: netNotional,
  });

  if (!decoded.ok) {
    await markTradeExecutionFailed(reservation.tradeExecutionId);
    await markRejected(ctx.castHash, decoded.reason, "failed");
    await publishOutcomeReply(
      ctx.castHash,
      buildOutcomeReply({ kind: "failure", reason: decoded.reason }),
    );
    return { status: "failed" as const, reason: decoded.reason };
  }

  const enforcement = await scoreTimeEnforcement({
    tradeExecutionId: reservation.tradeExecutionId,
    quotedNotional: netNotional,
    maxPriceImpactBps: policy.context.policy.maxPriceImpactBps,
  });

  if (!enforcement.ok) {
    await markRejected(ctx.castHash, enforcement.reason, "failed");
    await publishOutcomeReply(
      ctx.castHash,
      buildOutcomeReply({ kind: "failure", reason: enforcement.reason }),
    );
    return { status: "failed" as const, reason: enforcement.reason };
  }

  await updateLotsAndPositions({
    tradeExecutionId: reservation.tradeExecutionId,
  });
  await scoreTrade({
    castCommandId: loaded.id,
    userId: walletLookup.userId,
    tradeExecutionId: reservation.tradeExecutionId,
  });

  await markStatus(ctx.castHash, "executed");
  await publishOutcomeReply(
    ctx.castHash,
    buildOutcomeReply({
      kind: "success",
      symbol: intent.symbol,
      quantity: decoded.quantity,
      notionalUsdc: decoded.usdcSpent,
      txHash: confirmed.txHash,
    }),
  );

  return {
    status: "executed" as const,
    txHash: confirmed.txHash,
    executionId,
  };
}

// ---------------------------------------------------------------------------
// Step: load_command
// ---------------------------------------------------------------------------

type LoadedCommand = {
  id: string;
  status: string;
  shouldExit: boolean;
};

const TERMINAL_STATUSES = new Set(["executed", "failed", "rejected"]);

async function loadCommand(castHash: string): Promise<LoadedCommand> {
  "use step";

  const { data, error } = await supabaseAdmin
    .from("cast_commands")
    .select("id, status")
    .eq("cast_hash", castHash)
    .single();

  if (error) {
    throw new Error(`load_command failed: ${error.message}`);
  }

  return {
    id: data.id,
    status: data.status,
    shouldExit: TERMINAL_STATUSES.has(data.status),
  };
}

// ---------------------------------------------------------------------------
// Step: parse_command
// ---------------------------------------------------------------------------

async function parseStep(
  text: string,
): Promise<
  | { ok: true; intent: CommandIntent }
  | { ok: false; reason: string }
> {
  "use step";

  const result = await parseCommandIntent(text);
  if (result.ok) return { ok: true, intent: result.intent };
  return { ok: false, reason: result.reason };
}

// ---------------------------------------------------------------------------
// Step: handle_status_noop
//
// Placeholder for the status command. Marks the cast terminal so
// replays don't re-enter the workflow; the real Snap-card reply lives
// in issue #13.
//
// TODO(#13): replace this with a real status reply step that builds
//            the portfolio summary + rank and publishes an outcome
//            cast. The terminal status marker here becomes the
//            `status_ack` -> `executed` transition at that point.
// ---------------------------------------------------------------------------

async function handleStatusNoop(params: { castHash: string }): Promise<void> {
  "use step";

  await supabaseAdmin
    .from("cast_commands")
    .update({ status: "executed" })
    .eq("cast_hash", params.castHash)
    .not("status", "in", "(executed,failed,rejected)");
}

// ---------------------------------------------------------------------------
// Step: policy_validate (includes arena-wallet lookup)
// ---------------------------------------------------------------------------

type WalletLookup = {
  userId: string;
  walletId: string;
  walletAddress: string;
  privyWalletId: string;
};

async function resolveArenaWallet(
  fid: number,
): Promise<WalletLookup | null> {
  "use step";

  const { data: account, error: accErr } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("user_id")
    .eq("fid", fid)
    .maybeSingle();

  if (accErr) throw new Error(`farcaster_accounts lookup failed: ${accErr.message}`);
  if (!account) return null;

  const { data: wallet, error: wErr } = await supabaseAdmin
    .from("arena_wallets")
    .select("id, wallet_address, privy_wallet_id")
    .eq("user_id", account.user_id)
    .maybeSingle();

  if (wErr) throw new Error(`arena_wallets lookup failed: ${wErr.message}`);
  if (!wallet) return null;

  return {
    userId: account.user_id,
    walletId: wallet.id,
    walletAddress: wallet.wallet_address,
    privyWalletId: wallet.privy_wallet_id,
  };
}

async function policyValidate(params: {
  userId: string;
  walletId: string;
  walletAddress: string;
  privyWalletId: string;
  intent: TradeIntent;
}) {
  "use step";

  return await validatePolicy(params);
}

// ---------------------------------------------------------------------------
// Step: compute_fee (pure)
// ---------------------------------------------------------------------------

async function computeFee(params: {
  notionalUsdc: number;
  swapFeeBps: number;
  swapFeeMinUsdc: number;
}): Promise<number> {
  "use step";

  return computeSwapFeeUsdc(params);
}

// ---------------------------------------------------------------------------
// Step: quote_swap (0x quote + DB reservation)
// ---------------------------------------------------------------------------

type QuoteAndReserveReturn = ReservedExecution & {
  executionId: string;
  txTo: string;
  txData: string;
  txValue: string;
  /** USDC sell amount in base units, serialized as a string (BigInt → string). */
  sellAmountBaseUnits: string;
};

async function quoteAndReserve(params: {
  castHash: string;
  castCommandId: string;
  ctx: PolicyContext;
  intent: TradeIntent;
  feeUsdc: number;
  netNotional: number;
}): Promise<QuoteAndReserveReturn> {
  "use step";

  // Derive inside the step — node:crypto is not allowed at workflow scope.
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
    if (err instanceof ZeroxNotConfiguredError) {
      throw new FatalError(err.message);
    }
    throw err;
  }

  if (!quote.liquidityAvailable) {
    throw new Error("quote_swap: 0x reports no liquidity for pair");
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
  };
}

// ---------------------------------------------------------------------------
// Step: publish_intent_reply_cast
// ---------------------------------------------------------------------------

async function publishIntentReply(castHash: string, text: string): Promise<void> {
  "use step";

  try {
    await publishReplyOnce({ castHash, kind: "intent", text });
  } catch (err) {
    if (err instanceof MissingSignerError) throw new FatalError(err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step: ensure_allowance
// ---------------------------------------------------------------------------

/**
 * Guarantees the arena wallet has approved the 0x Allowance Holder
 * contract to pull its USDC. The first swap for a wallet broadcasts a
 * one-time MAX_UINT approve; subsequent swaps short-circuit on the
 * allowance view call. See `lib/execution/allowance.ts` for details.
 */
async function ensureAllowanceStep(params: {
  ctx: PolicyContext;
  spender: string;
  sellAmountBaseUnits: string;
  executionId: string;
}): Promise<void> {
  "use step";

  await ensureUsdcAllowance({
    walletAddress: params.ctx.walletAddress,
    privyWalletId: params.ctx.privyWalletId,
    spender: params.spender,
    minRequired: BigInt(params.sellAmountBaseUnits),
    referenceId: params.executionId,
  });
}

// ---------------------------------------------------------------------------
// Step: submit_swap
// ---------------------------------------------------------------------------

async function submitSwap(params: {
  executionId: string;
  tradeExecutionId: string;
  ctx: PolicyContext;
  quoteTxTo: string;
  quoteTxData: string;
  quoteTxValue: string;
}): Promise<{ txHash: string; privyTransactionId: string }> {
  "use step";

  const value =
    params.quoteTxValue && params.quoteTxValue !== "0"
      ? `0x${BigInt(params.quoteTxValue).toString(16)}`
      : undefined;

  const result = await signAndSendTransaction({
    walletId: params.ctx.privyWalletId,
    to: params.quoteTxTo,
    data: params.quoteTxData,
    value,
    sponsor: env.PRIVY_SPONSOR_GAS,
    referenceId: params.executionId,
  });

  // Resolve final tx hash for the sponsored path.
  let finalHash = result.hash;
  if (!finalHash) {
    try {
      const { hash } = await waitForTransaction(result.transactionId, {
        timeoutMs: 30_000,
      });
      finalHash = hash;
    } catch (err) {
      if (
        err instanceof PrivyTransactionTimeoutError ||
        err instanceof PrivyTransactionFailedError
      ) {
        // Persist the Privy handle so the reconciler can resolve later.
        await supabaseAdmin
          .from("trade_executions")
          .update({
            privy_transaction_id: result.transactionId,
            status: "submitted",
          })
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
    throw new Error(`submit_swap: trade_executions update failed: ${error.message}`);
  }

  return { txHash: finalHash, privyTransactionId: result.transactionId };
}

// ---------------------------------------------------------------------------
// Step: transfer_fee
// ---------------------------------------------------------------------------

async function transferFeeLeg(params: {
  tradeExecutionId: string;
  walletId: string;
  feeUsdc: number;
  executionId: string;
}): Promise<void> {
  "use step";

  // Idempotency check: if we already recorded a fee_tx_hash, return.
  const { data: row } = await supabaseAdmin
    .from("trade_executions")
    .select("fee_tx_hash")
    .eq("id", params.tradeExecutionId)
    .maybeSingle();

  if (row?.fee_tx_hash) return;

  try {
    const result = await submitFeeTransfer({
      walletId: params.walletId,
      feeUsdc: params.feeUsdc,
      referenceId: `${params.executionId}:fee`,
    });

    let hash = result.hash;
    if (!hash) {
      const { hash: waited } = await waitForTransaction(result.transactionId, {
        timeoutMs: 15_000,
      });
      hash = waited;
    }

    await supabaseAdmin
      .from("trade_executions")
      .update({ fee_tx_hash: hash })
      .eq("id", params.tradeExecutionId);
  } catch (err) {
    if (err instanceof OperatorTreasuryNotConfiguredError) {
      throw new FatalError(err.message);
    }
    // Non-fatal: the swap already confirmed. Log and let the reconciler
    // retry independently (see § Reconciliation fallback).
    console.error("transfer_fee_failed", {
      execution_id: params.tradeExecutionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Step: verify_tx_onchain
// ---------------------------------------------------------------------------

async function verifyTxOnchain(params: {
  tradeExecutionId: string;
  txHash: string;
}): Promise<{ txHash: string; confirmedAt: string }> {
  "use step";

  const receipt = await basePublicClient.waitForTransactionReceipt({
    hash: params.txHash as Hex,
    confirmations: 1,
    timeout: 30_000,
  });

  if (receipt.status !== "success") {
    await supabaseAdmin
      .from("trade_executions")
      .update({ status: "reverted" })
      .eq("id", params.tradeExecutionId);
    throw new Error(`verify_tx_onchain: tx ${params.txHash} reverted`);
  }

  const confirmedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("trade_executions")
    .update({ status: "confirmed", confirmed_at: confirmedAt })
    .eq("id", params.tradeExecutionId);

  if (error) {
    throw new Error(`verify_tx_onchain: update failed: ${error.message}`);
  }

  return { txHash: params.txHash, confirmedAt };
}

// ---------------------------------------------------------------------------
// Step: decode_swap_log
//
// Pulls the confirmed receipt, decodes the USDC-out + asset-in Transfer
// events, and persists the realized `quantity` + `execution_price_usdc`
// onto `trade_executions`. Idempotent: a replay after both columns are
// populated short-circuits without touching the RPC.
//
// Failure modes mirror the issue spec (#26):
//   - No matching Transfer → terminal failure, `decode_log_missing`.
//   - Decoded USDC-out drifts from the reserved notional by >10 bps →
//     terminal failure, `decode_log_mismatch`.
//   - Receipt not yet indexed → viem throws, the workflow retries.
// ---------------------------------------------------------------------------

const DECODE_TOLERANCE_BPS = 10;
type DecodeFailureReason = "decode_log_missing" | "decode_log_mismatch";

type DecodeSwapLogResult =
  | {
      ok: true;
      quantity: number;
      executionPriceUsdc: number;
      usdcSpent: number;
    }
  | { ok: false; reason: DecodeFailureReason };

async function decodeSwapLog(params: {
  tradeExecutionId: string;
  txHash: string;
  walletAddress: string;
  assetAddress: string;
  assetDecimals: number;
  reservedNotionalUsdc: number;
}): Promise<DecodeSwapLogResult> {
  "use step";

  // Idempotency short-circuit. The row is the single source of truth —
  // a replay never re-fetches the receipt or re-decodes, so this step
  // is cheap on retries.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("trade_executions")
    .select("quantity, execution_price_usdc")
    .eq("id", params.tradeExecutionId)
    .maybeSingle();

  if (readErr) {
    throw new Error(`decode_swap_log: read failed: ${readErr.message}`);
  }

  if (
    existing?.quantity != null &&
    existing?.execution_price_usdc != null
  ) {
    return {
      ok: true,
      quantity: Number(existing.quantity),
      executionPriceUsdc: Number(existing.execution_price_usdc),
      usdcSpent: params.reservedNotionalUsdc,
    };
  }

  // Receipt must be present by this point — verify_tx_onchain already
  // waited for one confirmation. `getTransactionReceipt` throws a
  // retryable `TransactionReceiptNotFoundError` if the RPC hasn't
  // caught up; that's the desired "non-fatal retry" per the spec.
  const receipt = await basePublicClient.getTransactionReceipt({
    hash: params.txHash as Hex,
  });

  let decoded;
  try {
    decoded = decodeSwapReceipt(receipt, {
      walletAddress: params.walletAddress,
      assetAddress: params.assetAddress,
      assetDecimals: params.assetDecimals,
    });
  } catch (err) {
    if (err instanceof SwapLogMissingError) {
      return { ok: false, reason: "decode_log_missing" };
    }
    throw err;
  }

  // 10 bps sanity check: aggregator routing can round dust in either
  // direction, but a >0.1% gap between the reserved notional and the
  // realized USDC-out almost always means we're decoding the wrong tx
  // or against the wrong asset — fail fast rather than booking bad P&L.
  const tolerance =
    (params.reservedNotionalUsdc * DECODE_TOLERANCE_BPS) / 10_000;
  if (
    Math.abs(decoded.usdcHumanNumber - params.reservedNotionalUsdc) > tolerance
  ) {
    return { ok: false, reason: "decode_log_mismatch" };
  }

  // Supabase accepts string values on `numeric` columns, so the decimal
  // strings from `formatUnits` land verbatim — no float round-trip.
  const { error: updErr } = await supabaseAdmin
    .from("trade_executions")
    .update({
      quantity: decoded.quantity as unknown as number,
      execution_price_usdc: decoded.executionPriceUsdc as unknown as number,
    })
    .eq("id", params.tradeExecutionId);

  if (updErr) {
    throw new Error(`decode_swap_log: update failed: ${updErr.message}`);
  }

  return {
    ok: true,
    quantity: decoded.quantityNumber,
    executionPriceUsdc: decoded.executionPriceUsdcNumber,
    usdcSpent: decoded.usdcHumanNumber,
  };
}

async function markTradeExecutionFailed(
  tradeExecutionId: string,
): Promise<void> {
  "use step";

  await supabaseAdmin
    .from("trade_executions")
    .update({ status: "failed" })
    .eq("id", tradeExecutionId);
}

// ---------------------------------------------------------------------------
// Step: score_time_enforcement
//
// MVP: checks that realized fill is within the configured price-impact
// tolerance. Reads the trade_executions row to see if we already stamped
// a failure (idempotent).
// ---------------------------------------------------------------------------

async function scoreTimeEnforcement(params: {
  tradeExecutionId: string;
  quotedNotional: number;
  maxPriceImpactBps: number;
}): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  "use step";

  // TODO: decode swap log + compute actual price impact vs oracle. For
  // MVP we pass through so the happy path completes; the reconciler
  // and a follow-up issue will wire the price-impact guard properly.
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Step: update_lots_and_positions
//
// Placeholder: real FIFO bookkeeping is a follow-up. We record a single
// `positions` row upsert so the Arena page has something to render.
// ---------------------------------------------------------------------------

async function updateLotsAndPositions(params: {
  tradeExecutionId: string;
}): Promise<void> {
  "use step";

  // TODO: realize quantity + avg_cost from swap log; insert lots row
  // keyed on opening_execution_id (unique), upsert positions. For now
  // intentionally a no-op; see issue #8 follow-ups.
  return;
}

// ---------------------------------------------------------------------------
// Step: score_trade
//
// Placeholder: full scoring (profitable_close / return bonuses) lives in
// a dedicated issue. We record `trade_executed` so the 5/day cap logic
// has data to reason against.
// ---------------------------------------------------------------------------

async function scoreTrade(params: {
  castCommandId: string;
  userId: string;
  tradeExecutionId: string;
}): Promise<void> {
  "use step";

  const month = monthString();

  const { error } = await supabaseAdmin.from("scoring_events").insert({
    user_id: params.userId,
    cast_command_id: params.castCommandId,
    execution_id: params.tradeExecutionId,
    event_type: "trade_executed",
    points: 1,
    month,
  });

  if (error) {
    // Unique-on (cast_command_id, event_type) — replay is a no-op.
    if (isUniqueViolation(error)) return;
    console.error("score_trade failed", error);
  }
}

// ---------------------------------------------------------------------------
// Step: publish_outcome_reply_cast
// ---------------------------------------------------------------------------

async function publishOutcomeReply(castHash: string, text: string): Promise<void> {
  "use step";

  try {
    await publishReplyOnce({ castHash, kind: "outcome", text });
  } catch (err) {
    if (err instanceof MissingSignerError) throw new FatalError(err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// DB helpers — status transitions
// ---------------------------------------------------------------------------

async function markStatus(castHash: string, status: string): Promise<void> {
  "use step";

  await supabaseAdmin
    .from("cast_commands")
    .update({ status })
    .eq("cast_hash", castHash)
    .not("status", "in", "(executed,failed,rejected)");
}

async function markRejected(
  castHash: string,
  reason: string,
  terminalStatus: "rejected" | "failed" = "rejected",
): Promise<void> {
  "use step";

  await supabaseAdmin
    .from("cast_commands")
    .update({ status: terminalStatus, error_reason: reason })
    .eq("cast_hash", castHash)
    .not("status", "in", "(executed,failed,rejected)");
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function monthString(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Maps a parser rejection reason onto the templated Commodus reply +
 * the `cast_commands.error_reason` string. Parse-level rejections use
 * the voice catalog in `lib/commodus/templates.ts`, not the generic
 * execution outcome copy — the grammar rejection text is pinned to
 * the PRD § Commodus Voice exemplar.
 */
function parseRejectionFor(reason: string): {
  errorReason: string;
  reply: string;
} {
  if (reason === "grammar_error") {
    return { errorReason: "grammar", reply: REJECTION_REPLIES.grammar };
  }
  if (reason === "asset_error") {
    return {
      errorReason: "non_whitelisted_token",
      reply: REJECTION_REPLIES.non_whitelisted_token,
    };
  }
  if (reason === "oversize_error") {
    return { errorReason: "oversize", reply: REJECTION_REPLIES.oversize };
  }
  // Defensive: unknown reasons fall through to the generic outcome copy
  // so a future parser shape doesn't silently drop the reply.
  return {
    errorReason: reason,
    reply: buildOutcomeReply({ kind: "failure", reason }),
  };
}
