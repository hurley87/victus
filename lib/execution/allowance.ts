import "server-only";

import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  maxUint256,
  type Hex,
} from "viem";

import { USDC_BASE_ADDRESS } from "@/lib/chain/addresses";
import { basePublicClient } from "@/lib/chain/client";
import { env } from "@/lib/env";
import {
  PrivyTransactionFailedError,
  PrivyTransactionTimeoutError,
  signAndSendTransaction,
  waitForTransaction,
} from "@/lib/privy/server";

/**
 * Ensures the arena wallet has sufficient USDC allowance for the 0x
 * Allowance Holder spender returned by the quote.
 *
 * The 0x Allowance Holder flow requires the taker to have approved the
 * AllowanceHolder contract (a single canonical Permit2-style spender)
 * for the sell token prior to executing the swap. Without it, the swap
 * calldata reverts on-chain with `ERC20: transfer amount exceeds
 * allowance` during Privy's broadcast simulation.
 *
 * We approve for `MAX_UINT256` on first use so every subsequent swap
 * from the same wallet/token pair is a single transaction. The on-chain
 * `allowance(owner, spender)` read is free — calling it each swap keeps
 * the module stateless and recovers correctly from lost DB rows.
 *
 * Idempotency:
 *   - Replays after a successful approval see `allowance >= minRequired`
 *     on the view call and short-circuit.
 *   - The approval tx's `referenceId` is suffixed with `:approve` so it
 *     doesn't collide with the swap's `execution_id`.
 */
export type EnsureAllowanceResult =
  | { kind: "already-approved" }
  | { kind: "approved"; txHash: Hex };

/**
 * Generic ERC-20 MAX approval against the Allowance Holder spender.
 * `ensureUsdcAllowance` is a thin wrapper for the USDC leg on buys.
 */
export async function ensureErc20Allowance(params: {
  tokenAddress: string;
  walletAddress: string;
  privyWalletId: string;
  spender: string;
  minRequired: bigint;
  referenceId: string;
}): Promise<EnsureAllowanceResult> {
  const token = getAddress(params.tokenAddress);
  const owner = getAddress(params.walletAddress);
  const spender = getAddress(params.spender);

  const current = await basePublicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });

  if (current >= params.minRequired) {
    return { kind: "already-approved" };
  }

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, maxUint256],
  });

  const submitted = await signAndSendTransaction({
    walletId: params.privyWalletId,
    to: token,
    data,
    sponsor: env.PRIVY_SPONSOR_GAS,
    referenceId: `${params.referenceId}:approve`,
  });

  let hash = submitted.hash as Hex | "";
  if (!hash) {
    try {
      const { hash: waited } = await waitForTransaction(
        submitted.transactionId,
        { timeoutMs: 30_000 },
      );
      hash = waited as Hex;
    } catch (err) {
      if (
        err instanceof PrivyTransactionTimeoutError ||
        err instanceof PrivyTransactionFailedError
      ) {
        throw new Error(
          `ensure_allowance: approval did not confirm (${err.name})`,
        );
      }
      throw err;
    }
  }

  // Wait for the receipt so the downstream swap step sees the new
  // allowance on the public RPC. Without this the swap can still race
  // the mempool-to-block lag and re-hit the same allowance revert.
  await basePublicClient.waitForTransactionReceipt({
    hash: hash as Hex,
    timeout: 30_000,
  });

  return { kind: "approved", txHash: hash as Hex };
}

export async function ensureUsdcAllowance(params: {
  walletAddress: string;
  privyWalletId: string;
  spender: string;
  minRequired: bigint;
  referenceId: string;
}): Promise<EnsureAllowanceResult> {
  return ensureErc20Allowance({
    tokenAddress: USDC_BASE_ADDRESS,
    walletAddress: params.walletAddress,
    privyWalletId: params.privyWalletId,
    spender: params.spender,
    minRequired: params.minRequired,
    referenceId: params.referenceId,
  });
}
