import "server-only";

import { parseUnits } from "viem";

import { buildErc20TransferCalldata } from "@/lib/chain/erc20-calldata";
import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import { env } from "@/lib/env";
import {
  signAndSendTransaction,
  waitForTransaction,
  type PrivyTransactionResult,
} from "@/lib/privy/server";

/**
 * Privy-signed USDC transfer of the swap fee from the arena wallet to
 * the operator treasury.
 *
 * The workflow's `transfer_fee` step wraps this. Failure here is
 * intentionally non-fatal for scoring: the swap already confirmed, so
 * we mark the fee leg as failed on the `trade_executions` row and let
 * the reconciler retry independently. That's why this helper returns
 * `{ hash, privyTransactionId }` and does NOT throw on Privy's
 * terminal-failure path — the caller decides how to record it.
 *
 * Idempotency: the caller must check `trade_executions.fee_tx_hash` is
 * null before invoking. A successful broadcast populates that column
 * (and the unique constraint trips on a replay).
 */

export class OperatorTreasuryNotConfiguredError extends Error {
  constructor() {
    super("OPERATOR_TREASURY_ADDRESS is not configured");
    this.name = "OperatorTreasuryNotConfiguredError";
  }
}

export type TransferFeeParams = {
  /** Privy wallet id for the arena wallet being debited. */
  walletId: string;
  /** USDC fee amount as a decimal number (e.g. 0.05 for $0.05). */
  feeUsdc: number;
  /** Reference id for Privy's transaction log; recommend the execution_id. */
  referenceId?: string;
};

export type TransferFeeResult = {
  /** Privy-side transaction id; use to reconcile a `submitted`-stuck row. */
  privyTransactionId: string;
  /**
   * On-chain tx hash. Empty string immediately after the sponsored
   * broadcast; resolve via `waitForTransaction` to populate.
   */
  hash: string;
};

/**
 * Kick off the USDC fee transfer. Returns the Privy transaction handle
 * on broadcast; the caller decides whether to synchronously wait for
 * confirmation via {@link waitForFeeTransfer} or fire-and-forget and
 * reconcile later.
 */
export async function submitFeeTransfer(
  params: TransferFeeParams,
): Promise<PrivyTransactionResult> {
  if (!env.OPERATOR_TREASURY_ADDRESS) {
    throw new OperatorTreasuryNotConfiguredError();
  }

  // Round fee to USDC's 6-decimal precision. Any sub-cent dust below
  // 10^-6 is dropped — immaterial at the scale of a $0.05 minimum fee.
  const amount = parseUnits(params.feeUsdc.toFixed(USDC_DECIMALS), USDC_DECIMALS);

  const data = buildErc20TransferCalldata(
    env.OPERATOR_TREASURY_ADDRESS,
    amount,
  );

  return await signAndSendTransaction({
    walletId: params.walletId,
    to: USDC_BASE_ADDRESS,
    data,
    sponsor: env.PRIVY_SPONSOR_GAS,
    referenceId: params.referenceId,
  });
}

/**
 * Block until the fee transfer reaches a terminal Privy status. Wraps
 * {@link waitForTransaction} with fee-transfer-appropriate timeouts.
 */
export async function waitForFeeTransfer(
  privyTransactionId: string,
): Promise<{ hash: string }> {
  const { hash } = await waitForTransaction(privyTransactionId, {
    // Fee transfer is a simple ERC-20 send; 15s is generous on Base.
    timeoutMs: 15_000,
  });
  return { hash };
}
