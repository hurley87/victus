import { FatalError } from "workflow";
import {
  formatUnits,
  getAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import { basePublicClient } from "@/lib/chain/client";
import {
  onboardingSnapUrlForFid,
  statusSnapUrlForFid,
  tradeSnapUrlForExecution,
} from "@/lib/commodus/deep-links";
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
  type AllowanceHolderQuote,
} from "@/lib/zerox/quote";

import { ensureErc20Allowance, ensureUsdcAllowance } from "@/lib/execution/allowance";
import {
  submitFeeTransfer,
  OperatorTreasuryNotConfiguredError,
} from "@/lib/execution/fee-transfer";
import { computeSwapFeeUsdc } from "@/lib/execution/fees";
import { deriveExecutionId } from "@/lib/execution/ids";
import { parseCommandIntent } from "@/lib/execution/parse";
import {
  validatePolicy,
  type PolicyContext,
} from "@/lib/execution/policy";
import { publishReplyOnce } from "@/lib/execution/reply-guard";
import { loadStatusViewContext } from "@/lib/status/load-context";
import {
  reserveOrLoadExecution,
  type ReservedExecution,
} from "@/lib/execution/reserve";
import { applyLotsAndPositionsForExecution } from "@/lib/execution/lot-persistence";
import { scoreTradeAfterExecution } from "@/lib/scoring/score-trade";
import {
  decodeSwapReceipt,
  findDisallowedWalletTokens,
  SwapLogMissingError,
  type SwapDirection,
} from "@/lib/execution/swap-logs";
import {
  buildIntentReply,
  buildOutcomeReply,
  buildStatusReplyText,
  policyRejectionMessage,
  type CommodusVoiceContext,
} from "@/lib/execution/templates";
import type { CommandIntent, SellIntent, TradeIntent } from "@/lib/execution/intents";
import { log } from "@/lib/logger";

async function logStep<T>(castHash: string, step: string, fn: () => Promise<T>): Promise<T> {
  const lg = log.child({ castHash, step });
  const start = Date.now();
  lg.info("step_start");
  try {
    const result = await fn();
    lg.info("step_end", { duration_ms: Date.now() - start });
    return result;
  } catch (err) {
    lg.error("step_failed", {
      duration_ms: Date.now() - start,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function rethrowMissingSignerAsFatal(err: unknown): never {
  if (err instanceof MissingSignerError) throw new FatalError(err.message);
  throw err;
}

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
 *   publish_intent_reply → ensure_allowance → submit_swap → verify_tx →
 *   decode_swap_log → transfer_fee → score_time_enforcement →
 *   update_lots_and_positions → score_trade → publish_outcome_reply
 *
 * Every step is `'use step'` and either pure or idempotent check-then-
 * act. Replays land on the same `execution_id` reservation and pick up
 * from the furthest-forward populated column (`tx_hash`, `confirmed_at`,
 * `cast_replies` rows, etc.).
 *
 * The happy path is fully implemented through `decode_swap_log` (#26),
 * FIFO lot accounting (#10), and the scoring engine (#11). Score-time
 * price-impact (#12) compares the realized fill to a reference 0x quote.
 */
export async function handleCommodusCommand(ctx: CommandContext) {
  "use workflow";

  const loaded = await loadCommand(ctx.castHash);
  if (loaded.shouldExit) {
    return { status: "noop" as const, reason: loaded.status };
  }

  const parseOutcome = await parseStep(ctx.castHash, ctx.text);
  if (!parseOutcome.ok) {
    const rejection = parseRejectionFor(parseOutcome.reason);
    await markRejected(ctx.castHash, rejection.errorReason);
    await publishOutcomeReply(ctx.castHash, rejection.reply);
    return { status: "rejected" as const, reason: rejection.errorReason };
  }

  const commandIntent = parseOutcome.intent;
  await markStatus(ctx.castHash, "parsed");

  // Status branch — short-circuit before the entire trade pipeline (templated reply + Snap embed, #20).
  if (commandIntent.action === "status") {
    await executeStatusBranch(ctx);
    return { status: "status_ack" as const };
  }

  const intent: TradeIntent = commandIntent;

  const walletLookup = await resolveArenaWallet(ctx.castHash, ctx.authorFid);
  if (!walletLookup) {
    await markRejected(ctx.castHash, "needs_gladiator_mint");
    await publishOutcomeReply(
      ctx.castHash,
      policyRejectionMessage("needs_gladiator_mint"),
      [{ url: onboardingSnapUrlForFid(ctx.authorFid) }],
    );
    return { status: "rejected" as const, reason: "needs_gladiator_mint" };
  }

  const voiceCtx: CommodusVoiceContext = {
    gladiatorName: walletLookup.gladiatorName,
  };

  const policyOutcome = await policyValidate(ctx.castHash, {
    userId: walletLookup.userId,
    walletId: walletLookup.walletId,
    walletAddress: walletLookup.walletAddress,
    privyWalletId: walletLookup.privyWalletId,
    intent,
  });
  if (!policyOutcome.ok) {
    await markRejected(ctx.castHash, policyOutcome.reason);
    await publishOutcomeReply(
      ctx.castHash,
      policyRejectionMessage(policyOutcome.reason, {
        maxTradeUsdc: policyOutcome.policy?.maxTradeUsdc,
        walletCapUsdc: policyOutcome.policy?.walletCapUsdc,
      }),
    );
    return { status: "rejected" as const, reason: policyOutcome.reason };
  }

  const policyCtx = policyOutcome.context;

  await markStatus(ctx.castHash, "validated");

  if (intent.action === "sell") {
    const sellIntent = intent;
    const sellAssetBaseUnits = policyCtx.sellAssetBaseUnits;
    if (!sellAssetBaseUnits) {
      throw new Error("sell pipeline: sellAssetBaseUnits missing from policy context");
    }

    const sellReservation = await quoteAndReserveSell({
      castHash: ctx.castHash,
      castCommandId: loaded.id,
      ctx: policyCtx,
      intent: sellIntent,
      sellAssetBaseUnits,
    });
    const sellExecutionId = sellReservation.executionId;

    if (sellReservation.reservedFillUsdc <= sellReservation.feeUsdc) {
      await markRejected(ctx.castHash, "max_trade_usdc");
      await publishOutcomeReply(
        ctx.castHash,
        policyRejectionMessage("max_trade_usdc", {
          maxTradeUsdc: policyCtx.policy.maxTradeUsdc,
        }),
      );
      return { status: "rejected" as const, reason: "fee_exceeds_notional" };
    }

    await markStatus(ctx.castHash, "quoted");

    await publishIntentReply(ctx.castHash, buildIntentReply(sellIntent, voiceCtx));

    await ensureSellAssetAllowance({
      castHash: ctx.castHash,
      ctx: policyCtx,
      spender: sellReservation.txTo,
      sellAssetBaseUnits,
      executionId: sellExecutionId,
    });

    const sellSubmitted: { txHash: string; privyTransactionId: string | null } =
      sellReservation.txHash
        ? {
            txHash: sellReservation.txHash,
            privyTransactionId: sellReservation.privyTransactionId,
          }
        : await submitSwap({
            castHash: ctx.castHash,
            executionId: sellExecutionId,
            tradeExecutionId: sellReservation.tradeExecutionId,
            ctx: policyCtx,
            quoteTxTo: sellReservation.txTo,
            quoteTxData: sellReservation.txData,
            quoteTxValue: sellReservation.txValue,
          });

    await markStatus(ctx.castHash, "executing");

    const sellConfirmed = sellReservation.confirmedAt
      ? { txHash: sellSubmitted.txHash, confirmedAt: sellReservation.confirmedAt }
      : await verifyTxOnchain({
          castHash: ctx.castHash,
          tradeExecutionId: sellReservation.tradeExecutionId,
          txHash: sellSubmitted.txHash,
        });

    const sellDecoded = await decodeSwapLog({
      castHash: ctx.castHash,
      tradeExecutionId: sellReservation.tradeExecutionId,
      txHash: sellConfirmed.txHash,
      walletAddress: policyCtx.walletAddress,
      assetAddress: policyCtx.assetAddress,
      assetDecimals: policyCtx.assetDecimals,
      reservedFillUsdc: sellReservation.reservedFillUsdc,
      direction: "asset_to_usdc",
    });

    if (!sellDecoded.ok) {
      await markTradeExecutionFailed(
        ctx.castHash,
        sellReservation.tradeExecutionId,
        sellDecoded.reason,
      );
      await markRejected(ctx.castHash, sellDecoded.reason, "failed");
      await publishOutcomeReply(
        ctx.castHash,
        buildOutcomeReply({ kind: "failure", reason: sellDecoded.reason }, voiceCtx),
      );
      return { status: "failed" as const, reason: sellDecoded.reason };
    }

    await transferFeeLeg({
      castHash: ctx.castHash,
      tradeExecutionId: sellReservation.tradeExecutionId,
      walletId: policyCtx.privyWalletId,
      feeUsdc: sellReservation.feeUsdc,
      executionId: sellExecutionId,
    });

    const sellEnforcement = await scoreTimeEnforcement({
      castHash: ctx.castHash,
      tradeExecutionId: sellReservation.tradeExecutionId,
      maxPriceImpactBps: policyCtx.policy.maxPriceImpactBps,
      maxSlippageBps: policyCtx.policy.maxSlippageBps,
      taker: policyCtx.walletAddress,
      assetAddress: policyCtx.assetAddress,
      assetDecimals: policyCtx.assetDecimals,
    });

    if (!sellEnforcement.ok) {
      await markTradeExecutionFailed(
        ctx.castHash,
        sellReservation.tradeExecutionId,
        sellEnforcement.reason,
      );
      await markRejected(ctx.castHash, sellEnforcement.reason, "failed");
      await publishOutcomeReply(
        ctx.castHash,
        buildOutcomeReply(
          { kind: "failure", reason: sellEnforcement.reason },
          voiceCtx,
          sellEnforcement.reason === "oversize"
            ? { maxTradeUsdc: policyCtx.policy.maxTradeUsdc }
            : undefined,
        ),
      );
      return { status: "failed" as const, reason: sellEnforcement.reason };
    }

    const sellPnl = await updateLotsAndPositions({
      castHash: ctx.castHash,
      tradeExecutionId: sellReservation.tradeExecutionId,
      intentAction: "sell",
    });

    await scoreTradeStep({
      castHash: ctx.castHash,
      castCommandId: loaded.id,
      userId: walletLookup.userId,
      tradeExecutionId: sellReservation.tradeExecutionId,
      intentAction: "sell",
    });

    await markStatus(ctx.castHash, "executed");
    await publishOutcomeReply(
      ctx.castHash,
      buildOutcomeReply(
        {
          kind: "success",
          action: "sell",
          symbol: sellIntent.symbol,
          quantity: sellDecoded.quantity,
          notionalUsdc: sellDecoded.fillUsdcHuman,
          txHash: sellConfirmed.txHash,
          realizedPnlUsdc: sellPnl.realizedPnlUsdc ?? undefined,
        },
        voiceCtx,
      ),
      [
        {
          url: tradeSnapUrlForExecution(
            ctx.authorFid,
            sellReservation.tradeExecutionId,
          ),
        },
      ],
    );

    return {
      status: "executed" as const,
      txHash: sellConfirmed.txHash,
      executionId: sellExecutionId,
    };
  }

  const feeUsdc = await computeFee(ctx.castHash, {
    notionalUsdc: intent.amount_value,
    swapFeeBps: policyCtx.policy.swapFeeBps,
    swapFeeMinUsdc: policyCtx.policy.swapFeeMinUsdc,
  });

  const netNotional = Math.max(intent.amount_value - feeUsdc, 0);

  if (netNotional <= 0) {
    await markRejected(ctx.castHash, "max_trade_usdc");
    await publishOutcomeReply(
      ctx.castHash,
      policyRejectionMessage("max_trade_usdc", {
        maxTradeUsdc: policyCtx.policy.maxTradeUsdc,
      }),
    );
    return { status: "rejected" as const, reason: "fee_exceeds_notional" };
  }

  const reservation = await quoteAndReserve({
    castHash: ctx.castHash,
    castCommandId: loaded.id,
    ctx: policyCtx,
    intent,
    feeUsdc,
    netNotional,
  });
  const executionId = reservation.executionId;

  await markStatus(ctx.castHash, "quoted");

  await publishIntentReply(ctx.castHash, buildIntentReply(intent, voiceCtx));

  await ensureAllowanceStep({
    castHash: ctx.castHash,
    ctx: policyCtx,
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
          castHash: ctx.castHash,
          executionId,
          tradeExecutionId: reservation.tradeExecutionId,
          ctx: policyCtx,
          quoteTxTo: reservation.txTo,
          quoteTxData: reservation.txData,
          quoteTxValue: reservation.txValue,
        });

  await markStatus(ctx.castHash, "executing");

  const confirmed = reservation.confirmedAt
    ? { txHash: submitted.txHash, confirmedAt: reservation.confirmedAt }
    : await verifyTxOnchain({
        castHash: ctx.castHash,
        tradeExecutionId: reservation.tradeExecutionId,
        txHash: submitted.txHash,
      });

  const decoded = await decodeSwapLog({
    castHash: ctx.castHash,
    tradeExecutionId: reservation.tradeExecutionId,
    txHash: confirmed.txHash,
    walletAddress: policyCtx.walletAddress,
    assetAddress: policyCtx.assetAddress,
    assetDecimals: policyCtx.assetDecimals,
    reservedFillUsdc: reservation.reservedFillUsdc,
    direction: "usdc_to_asset",
  });

  if (!decoded.ok) {
    await markTradeExecutionFailed(ctx.castHash, reservation.tradeExecutionId, decoded.reason);
    await markRejected(ctx.castHash, decoded.reason, "failed");
    await publishOutcomeReply(
      ctx.castHash,
      buildOutcomeReply({ kind: "failure", reason: decoded.reason }, voiceCtx),
    );
    return { status: "failed" as const, reason: decoded.reason };
  }

  await transferFeeLeg({
    castHash: ctx.castHash,
    tradeExecutionId: reservation.tradeExecutionId,
    walletId: policyCtx.privyWalletId,
    feeUsdc: reservation.feeUsdc,
    executionId,
  });

  const enforcement = await scoreTimeEnforcement({
    castHash: ctx.castHash,
    tradeExecutionId: reservation.tradeExecutionId,
    maxPriceImpactBps: policyCtx.policy.maxPriceImpactBps,
    maxSlippageBps: policyCtx.policy.maxSlippageBps,
    taker: policyCtx.walletAddress,
    assetAddress: policyCtx.assetAddress,
    assetDecimals: policyCtx.assetDecimals,
  });

  if (!enforcement.ok) {
    await markTradeExecutionFailed(
      ctx.castHash,
      reservation.tradeExecutionId,
      enforcement.reason,
    );
    await markRejected(ctx.castHash, enforcement.reason, "failed");
    await publishOutcomeReply(
      ctx.castHash,
      buildOutcomeReply(
        { kind: "failure", reason: enforcement.reason },
        voiceCtx,
        enforcement.reason === "oversize"
          ? { maxTradeUsdc: policyCtx.policy.maxTradeUsdc }
          : undefined,
      ),
    );
    return { status: "failed" as const, reason: enforcement.reason };
  }

  await updateLotsAndPositions({
    castHash: ctx.castHash,
    tradeExecutionId: reservation.tradeExecutionId,
    intentAction: "buy",
  });
  await scoreTradeStep({
    castHash: ctx.castHash,
    castCommandId: loaded.id,
    userId: walletLookup.userId,
    tradeExecutionId: reservation.tradeExecutionId,
    intentAction: "buy",
  });

  await markStatus(ctx.castHash, "executed");
  await publishOutcomeReply(
    ctx.castHash,
    buildOutcomeReply(
      {
        kind: "success",
        action: "buy",
        symbol: intent.symbol,
        quantity: decoded.quantity,
        notionalUsdc: decoded.fillUsdcHuman,
        txHash: confirmed.txHash,
      },
      voiceCtx,
    ),
    [
      {
        url: tradeSnapUrlForExecution(
          ctx.authorFid,
          reservation.tradeExecutionId,
        ),
      },
    ],
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

  return logStep(castHash, "load_command", async () => {
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
  });
}

// ---------------------------------------------------------------------------
// Step: parse_command
// ---------------------------------------------------------------------------

async function parseStep(
  castHash: string,
  text: string,
): Promise<
  | { ok: true; intent: CommandIntent }
  | { ok: false; reason: string }
> {
  "use step";

  return logStep(castHash, "parse_command", async () => {
    const result = await parseCommandIntent(text);
    if (result.ok) return { ok: true, intent: result.intent };
    return { ok: false, reason: result.reason };
  });
}

// ---------------------------------------------------------------------------
// Step: execute_status_branch
//
// Templated text + Snap embed URL; read-only (no scoring / no slot use).
// ---------------------------------------------------------------------------

async function executeStatusBranch(ctx: CommandContext): Promise<void> {
  "use step";

  return logStep(ctx.castHash, "execute_status_branch", async () => {
    const view = await loadStatusViewContext(ctx.authorFid);

    if (!view) {
      try {
        await publishReplyOnce({
          castHash: ctx.castHash,
          kind: "outcome",
          text: REJECTION_REPLIES.no_arena_wallet,
          embeds: [{ url: onboardingSnapUrlForFid(ctx.authorFid) }],
        });
      } catch (err) {
        rethrowMissingSignerAsFatal(err);
      }
    } else {
      const text = buildStatusReplyText({
        displayHandle: view.displayHandle,
        rank: view.rank,
        points: view.points,
        portfolioUsdc: view.portfolioUsdc,
        dailySlotsRemaining: view.dailySlotsRemaining,
      });
      try {
        await publishReplyOnce({
          castHash: ctx.castHash,
          kind: "outcome",
          text,
          embeds: [{ url: statusSnapUrlForFid(ctx.authorFid) }],
        });
      } catch (err) {
        rethrowMissingSignerAsFatal(err);
      }
    }

    await supabaseAdmin
      .from("cast_commands")
      .update({ status: "executed" })
      .eq("cast_hash", ctx.castHash)
      .not("status", "in", "(executed,failed,rejected)");
  });
}

// ---------------------------------------------------------------------------
// Step: policy_validate (includes arena-wallet lookup)
// ---------------------------------------------------------------------------

type WalletLookup = {
  userId: string;
  walletId: string;
  walletAddress: string;
  privyWalletId: string;
  gladiatorName: string;
};

async function resolveArenaWallet(
  castHash: string,
  fid: number,
): Promise<WalletLookup | null> {
  "use step";

  return logStep(castHash, "resolve_arena_wallet", async () => {
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

    const { data: glad } = await supabaseAdmin
      .from("gladiators")
      .select("name")
      .eq("user_id", account.user_id)
      .maybeSingle();

    return {
      userId: account.user_id,
      walletId: wallet.id,
      walletAddress: wallet.wallet_address,
      privyWalletId: wallet.privy_wallet_id,
      gladiatorName: typeof glad?.name === "string" ? glad.name.trim() : "",
    };
  });
}

function rethrowZeroxNotConfiguredAsFatal(err: unknown): never {
  if (err instanceof ZeroxNotConfiguredError) {
    throw new FatalError(err.message);
  }
  throw err;
}

async function policyValidate(
  castHash: string,
  params: {
    userId: string;
    walletId: string;
    walletAddress: string;
    privyWalletId: string;
    intent: TradeIntent;
  },
) {
  "use step";

  return logStep(castHash, "policy_validate", async () => {
    try {
      return await validatePolicy(params);
    } catch (err) {
      rethrowZeroxNotConfiguredAsFatal(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Step: compute_fee (pure)
// ---------------------------------------------------------------------------

async function computeFee(
  castHash: string,
  params: {
    notionalUsdc: number;
    swapFeeBps: number;
    swapFeeMinUsdc: number;
  },
): Promise<number> {
  "use step";

  return logStep(castHash, "compute_fee", async () => computeSwapFeeUsdc(params));
}

// ---------------------------------------------------------------------------
// Step: quote_swap (0x quote + DB reservation)
// ---------------------------------------------------------------------------

type QuoteAndReserveReturn = ReservedExecution & {
  executionId: string;
  txTo: string;
  txData: string;
  txValue: string;
  /** Sell-token amount in base units, serialized as a string (BigInt → string). */
  sellAmountBaseUnits: string;
  /** USDC anchor for decode tolerance (net swap leg on buys; gross USDC in on sells). */
  reservedFillUsdc: number;
  feeUsdc: number;
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

  return logStep(params.castHash, "quote_swap", async () => {
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
      rethrowZeroxNotConfiguredAsFatal(err);
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
      reservedFillUsdc: params.netNotional,
      feeUsdc: params.feeUsdc,
    };
  });
}

async function quoteAndReserveSell(params: {
  castHash: string;
  castCommandId: string;
  ctx: PolicyContext;
  intent: SellIntent;
  sellAssetBaseUnits: string;
}): Promise<QuoteAndReserveReturn> {
  "use step";

  return logStep(params.castHash, "quote_swap_sell", async () => {
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
      rethrowZeroxNotConfiguredAsFatal(err);
    }

    if (!quote.liquidityAvailable) {
      throw new Error("quote_swap_sell: 0x reports no liquidity for pair");
    }

    const grossUsdcExpected = Number(
      formatUnits(BigInt(quote.buyAmount), USDC_DECIMALS),
    );

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
  });
}

// ---------------------------------------------------------------------------
// Step: publish_intent_reply_cast
// ---------------------------------------------------------------------------

async function publishIntentReply(castHash: string, text: string): Promise<void> {
  "use step";

  return logStep(castHash, "publish_intent_reply", async () => {
    try {
      await publishReplyOnce({ castHash, kind: "intent", text });
    } catch (err) {
      rethrowMissingSignerAsFatal(err);
    }
  });
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
  castHash: string;
  ctx: PolicyContext;
  spender: string;
  sellAmountBaseUnits: string;
  executionId: string;
}): Promise<void> {
  "use step";

  return logStep(params.castHash, "ensure_allowance", async () => {
    await ensureUsdcAllowance({
      walletAddress: params.ctx.walletAddress,
      privyWalletId: params.ctx.privyWalletId,
      spender: params.spender,
      minRequired: BigInt(params.sellAmountBaseUnits),
      referenceId: params.executionId,
    });
  });
}

async function ensureSellAssetAllowance(params: {
  castHash: string;
  ctx: PolicyContext;
  spender: string;
  sellAssetBaseUnits: string;
  executionId: string;
}): Promise<void> {
  "use step";

  return logStep(params.castHash, "ensure_sell_asset_allowance", async () => {
    await ensureErc20Allowance({
      tokenAddress: params.ctx.assetAddress,
      walletAddress: params.ctx.walletAddress,
      privyWalletId: params.ctx.privyWalletId,
      spender: params.spender,
      minRequired: BigInt(params.sellAssetBaseUnits),
      referenceId: params.executionId,
    });
  });
}

// ---------------------------------------------------------------------------
// Step: submit_swap
// ---------------------------------------------------------------------------

async function submitSwap(params: {
  castHash: string;
  executionId: string;
  tradeExecutionId: string;
  ctx: PolicyContext;
  quoteTxTo: string;
  quoteTxData: string;
  quoteTxValue: string;
}): Promise<{ txHash: string; privyTransactionId: string }> {
  "use step";

  return logStep(params.castHash, "submit_swap", async () => {
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
  });
}

// ---------------------------------------------------------------------------
// Step: transfer_fee
// ---------------------------------------------------------------------------

async function transferFeeLeg(params: {
  castHash: string;
  tradeExecutionId: string;
  walletId: string;
  feeUsdc: number;
  executionId: string;
}): Promise<void> {
  "use step";

  return logStep(params.castHash, "transfer_fee", async () => {
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
      log.error("transfer_fee_failed", {
        castHash: params.castHash,
        tradeExecutionId: params.tradeExecutionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Step: verify_tx_onchain
// ---------------------------------------------------------------------------

async function verifyTxOnchain(params: {
  castHash: string;
  tradeExecutionId: string;
  txHash: string;
}): Promise<{ txHash: string; confirmedAt: string }> {
  "use step";

  return logStep(params.castHash, "verify_tx_onchain", async () => {
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
  });
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
type DecodeFailureReason =
  | "decode_log_missing"
  | "decode_log_mismatch"
  | "non_whitelisted_token";

type DecodeSwapLogResult =
  | {
      ok: true;
      quantity: number;
      executionPriceUsdc: number;
      /** Realized USDC leg: spent on buys, received (gross) on sells. */
      fillUsdcHuman: number;
    }
  | { ok: false; reason: DecodeFailureReason };

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
  "use step";

  return logStep(params.castHash, "decode_swap_log", async () => {
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("trade_executions")
      .select("quantity, execution_price_usdc, notional_usdc")
      .eq("id", params.tradeExecutionId)
      .maybeSingle();

    if (readErr) {
      throw new Error(`decode_swap_log: read failed: ${readErr.message}`);
    }

    if (
      existing?.quantity != null &&
      existing?.execution_price_usdc != null
    ) {
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

    const receipt = await basePublicClient.getTransactionReceipt({
      hash: params.txHash as Hex,
    });

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

    const tolerance =
      (params.reservedFillUsdc * DECODE_TOLERANCE_BPS) / 10_000;
    if (
      Math.abs(decoded.usdcHumanNumber - params.reservedFillUsdc) > tolerance
    ) {
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
      throw new Error(`decode_swap_log: update failed: ${updErr.message}`);
    }

    return {
      ok: true,
      quantity: decoded.quantityNumber,
      executionPriceUsdc: decoded.executionPriceUsdcNumber,
      fillUsdcHuman: decoded.usdcHumanNumber,
    };
  });
}

async function markTradeExecutionFailed(
  castHash: string,
  tradeExecutionId: string,
  failureReason: string,
): Promise<void> {
  "use step";

  return logStep(castHash, "mark_trade_execution_failed", async () => {
    await supabaseAdmin
      .from("trade_executions")
      .update({ status: "failed", failure_reason: failureReason })
      .eq("id", tradeExecutionId);
  });
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
        const sellWei = parseUnits(
          usdcHuman.toFixed(USDC_DECIMALS),
          USDC_DECIMALS,
        );
        return await getAllowanceHolderQuote({
          sellToken: USDC_BASE_ADDRESS,
          buyToken: params.assetAddress,
          sellAmount: sellWei.toString(),
          taker: params.taker,
          slippageBps: params.slippageBps,
          blockNumber: bn,
        });
      }

      const qtyStr = quantityFieldToParseString(
        params.quantity ?? "0",
        params.assetDecimals,
      );
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

  throw new Error(
    `reference 0x quote failed (±1 block): ${errors.join(" | ")}`,
  );
}

// ---------------------------------------------------------------------------
// Step: score_time_enforcement
//
// Compares realized on-chain fill vs. a reference 0x quote at the confirm
// block (±1). Breach → `price_impact` without scoring.
// ---------------------------------------------------------------------------

async function scoreTimeEnforcement(params: {
  castHash: string;
  tradeExecutionId: string;
  maxPriceImpactBps: number;
  maxSlippageBps: number;
  taker: Address;
  assetAddress: Address;
  assetDecimals: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  "use step";

  return logStep(params.castHash, "score_time_enforcement", async () => {
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("trade_executions")
      .select(
        "status, failure_reason, tx_hash, quantity, notional_usdc, trade_intents!inner(action)",
      )
      .eq("id", params.tradeExecutionId)
      .single();

    if (rowErr || !row) {
      throw new Error(`score_time_enforcement: load failed: ${rowErr?.message}`);
    }

    if (row.status === "failed" && row.failure_reason === "price_impact") {
      return { ok: false, reason: "price_impact" };
    }

    const intent = row.trade_intents as { action: string };

    if (
      row.quantity == null ||
      row.notional_usdc == null ||
      !row.tx_hash ||
      (intent.action !== "buy" && intent.action !== "sell")
    ) {
      return { ok: true };
    }

    const receipt = await basePublicClient.getTransactionReceipt({
      hash: row.tx_hash as Hex,
    });

    let ref: AllowanceHolderQuote;
    try {
      ref = await fetchReferenceZeroxQuoteForImpactCheck({
        intentAction: intent.action,
        assetAddress: params.assetAddress,
        assetDecimals: params.assetDecimals,
        quantity: row.quantity,
        notionalUsdc: row.notional_usdc,
        taker: params.taker,
        slippageBps: params.maxSlippageBps,
        blockNumber: receipt.blockNumber,
      });
    } catch (err) {
      rethrowZeroxNotConfiguredAsFatal(err);
    }

    if (!ref.liquidityAvailable) {
      return { ok: true };
    }

    const refOutWei = BigInt(ref.buyAmount);
    if (refOutWei === BigInt(0)) {
      return { ok: true };
    }

    let actualOutWei: bigint;
    if (intent.action === "buy") {
      const qtyStr = quantityFieldToParseString(
        row.quantity,
        params.assetDecimals,
      );
      actualOutWei = parseUnits(qtyStr, params.assetDecimals);
    } else {
      const usdcHuman = Number(row.notional_usdc);
      actualOutWei = parseUnits(usdcHuman.toFixed(USDC_DECIMALS), USDC_DECIMALS);
    }

    const diff =
      actualOutWei > refOutWei
        ? actualOutWei - refOutWei
        : refOutWei - actualOutWei;
    const impactBps = Number((diff * BigInt(10_000)) / refOutWei);

    if (impactBps > params.maxPriceImpactBps) {
      return { ok: false, reason: "price_impact" };
    }

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Step: update_lots_and_positions
//
// FIFO lot / position persistence via `applyLotsAndPositionsForExecution`.
// ---------------------------------------------------------------------------

async function updateLotsAndPositions(params: {
  castHash: string;
  tradeExecutionId: string;
  intentAction: "buy" | "sell";
}): Promise<{ realizedPnlUsdc: number | null }> {
  "use step";

  return logStep(params.castHash, "update_lots_and_positions", async () => {
    await applyLotsAndPositionsForExecution(params.tradeExecutionId);

    if (params.intentAction !== "sell") {
      return { realizedPnlUsdc: null };
    }

    const { data, error } = await supabaseAdmin
      .from("trade_executions")
      .select("realized_pnl_usdc")
      .eq("id", params.tradeExecutionId)
      .maybeSingle();

    if (error) {
      throw new Error(`update_lots_and_positions: read pnl failed: ${error.message}`);
    }

    return {
      realizedPnlUsdc:
        data?.realized_pnl_usdc != null ? Number(data.realized_pnl_usdc) : null,
    };
  });
}

async function scoreTradeStep(params: {
  castHash: string;
  castCommandId: string;
  userId: string;
  tradeExecutionId: string;
  intentAction: "buy" | "sell";
}): Promise<void> {
  "use step";

  return logStep(params.castHash, "score_trade", async () => {
    await scoreTradeAfterExecution({
      castCommandId: params.castCommandId,
      userId: params.userId,
      tradeExecutionId: params.tradeExecutionId,
      intentAction: params.intentAction,
    });
  });
}

// ---------------------------------------------------------------------------
// Step: publish_outcome_reply_cast
// ---------------------------------------------------------------------------

async function publishOutcomeReply(
  castHash: string,
  text: string,
  embeds?: { url: string }[],
): Promise<void> {
  "use step";

  return logStep(castHash, "publish_outcome_reply", async () => {
    try {
      await publishReplyOnce({ castHash, kind: "outcome", text, embeds });
    } catch (err) {
      rethrowMissingSignerAsFatal(err);
    }
  });
}

// ---------------------------------------------------------------------------
// DB helpers — status transitions
// ---------------------------------------------------------------------------

async function markStatus(castHash: string, status: string): Promise<void> {
  "use step";

  return logStep(castHash, "mark_status", async () => {
    await supabaseAdmin
      .from("cast_commands")
      .update({ status })
      .eq("cast_hash", castHash)
      .not("status", "in", "(executed,failed,rejected)");
  });
}

async function markRejected(
  castHash: string,
  reason: string,
  terminalStatus: "rejected" | "failed" = "rejected",
): Promise<void> {
  "use step";

  return logStep(castHash, "mark_rejected", async () => {
    await supabaseAdmin
      .from("cast_commands")
      .update({ status: terminalStatus, error_reason: reason })
      .eq("cast_hash", castHash)
      .not("status", "in", "(executed,failed,rejected)");
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

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
  // Defensive: unknown reasons fall through to the generic outcome copy
  // so a future parser shape doesn't silently drop the reply.
  return {
    errorReason: reason,
    reply: buildOutcomeReply({ kind: "failure", reason }, { gladiatorName: "" }),
  };
}
