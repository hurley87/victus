import "server-only";

import { getAddress, isAddress, parseUnits, type Address } from "viem";

import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import { readUsdcBalance } from "@/lib/chain/erc20";
import { buildErc20TransferCalldata } from "@/lib/chain/erc20-calldata";
import { fetchUser } from "@/lib/neynar";
import {
  PrivyApiError,
  PrivyNotConfiguredError,
  PrivyTransactionFailedError,
  PrivyTransactionTimeoutError,
  signAndSendTransaction,
  waitForTransaction,
} from "@/lib/privy/server";
import { redis } from "@/lib/redis";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Arena withdraw service — sweeps (or partial-sweeps) USDC from the
 * user's custodial Privy wallet back to their Farcaster-verified
 * destination. The first custodial outflow the platform supports.
 *
 * Destination resolution (per PRD § Rewards recipient rule): first
 * `farcaster_accounts.verifications[]` entry → Farcaster custody
 * address (via Neynar) → reject. We never sweep back to the arena
 * wallet itself.
 *
 * Idempotency is enforced by a Redis inflight lock (see `withdrawUsdc`);
 * transaction confirmation is polled via Privy, not the public Base
 * RPC — see `waitForTransaction` in `lib/privy/server.ts` for why.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Base class for withdraw failures. The `status` field lets the route
 * collapse its error ladder to a single `instanceof WithdrawError`
 * check — each subclass owns the HTTP status it maps to.
 *
 * Pattern: service layer throws semantic errors; transport layer
 * reads `err.status` and `err.message`. Any non-`WithdrawError` that
 * escapes the service is a programming bug → 500.
 */
export class WithdrawError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly extras?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ArenaWalletMissingError extends WithdrawError {
  constructor() {
    super("No arena wallet for this user", 404);
  }
}

export class GladiatorNotAliveError extends WithdrawError {
  constructor() {
    super("Gladiator must be alive to withdraw", 409);
  }
}

export class NoWithdrawDestinationError extends WithdrawError {
  constructor() {
    super("No Farcaster-verified destination address available", 403);
  }
}

export class InsufficientBalanceError extends WithdrawError {
  constructor(availableUsdc: number, requestedUsdc: number) {
    super(
      `Insufficient balance: ${availableUsdc} USDC available, ${requestedUsdc} requested`,
      409,
    );
  }
}

export class WithdrawInFlightError extends WithdrawError {
  constructor() {
    super("A withdraw is already in flight for this user", 409);
  }
}

/** 503: operator-scoped problem (unset creds, exhausted sponsorship). */
export class WithdrawUnavailableError extends WithdrawError {
  constructor(message = "Withdraw temporarily unavailable") {
    super(message, 503);
  }
}

/** 500: tx was broadcast but didn't reach a success terminal state. */
export class WithdrawFailedError extends WithdrawError {
  constructor(
    message: string,
    transactionId: string | null,
    transactionHash: string | null,
  ) {
    super(message, 500, {
      transaction_id: transactionId,
      transaction_hash: transactionHash,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type WithdrawResult = {
  tx_hash: string;
  amount_usdc: number;
  to: string;
  destination_source: "verification" | "custody";
};

export async function withdrawUsdc(params: {
  userId: string;
  fid: number;
  /**
   * USDC amount to withdraw. Undefined = sweep full live balance.
   * Positive, ≤ 6 decimals.
   */
  amountUsdc?: number;
}): Promise<WithdrawResult> {
  const { userId, fid, amountUsdc: requestedAmount } = params;

  const arena = await loadArenaState(userId);

  // Both reads only need `arena.walletAddress`; overlap the Supabase
  // lookup (destination) with the Base RPC read (balance) to cut one
  // round-trip off the critical path.
  const [destination, liveBalanceUsdc] = await Promise.all([
    resolveDestination(userId, fid, arena.walletAddress),
    readUsdcBalance(getAddress(arena.walletAddress)),
  ]);

  const amountUsdc = requestedAmount ?? liveBalanceUsdc;
  if (amountUsdc <= 0 || amountUsdc > liveBalanceUsdc + 1e-9) {
    throw new InsufficientBalanceError(liveBalanceUsdc, amountUsdc);
  }

  const amountBase = parseUnits(amountUsdc.toFixed(USDC_DECIMALS), USDC_DECIMALS);

  const inflightKey = `withdraw:inflight:${userId}`;
  const acquired = await redis.set(inflightKey, "1", { nx: true, ex: 120 });
  if (acquired !== "OK") {
    throw new WithdrawInFlightError();
  }

  const referenceId = crypto.randomUUID();

  console.info("withdraw.requested", {
    user_id: userId,
    arena_address: arena.walletAddress,
    to: destination.address,
    destination_source: destination.source,
    amount_usdc: amountUsdc,
    reference_id: referenceId,
  });

  try {
    const calldata = buildErc20TransferCalldata(destination.address, amountBase);
    const sent = await signAndSendTransaction({
      walletId: arena.privyWalletId,
      to: USDC_BASE_ADDRESS,
      data: calldata,
      sponsor: true,
      referenceId,
    });

    const { hash, status } = await waitForTransaction(sent.transactionId, {
      timeoutMs: 30_000,
    });

    console.info("withdraw.confirmed", {
      user_id: userId,
      arena_address: arena.walletAddress,
      to: destination.address,
      amount_usdc: amountUsdc,
      tx_hash: hash,
      privy_transaction_id: sent.transactionId,
      privy_status: status,
      reference_id: referenceId,
    });

    return {
      tx_hash: hash,
      amount_usdc: amountUsdc,
      to: destination.address,
      destination_source: destination.source,
    };
  } catch (err) {
    console.error("withdraw.failed", {
      user_id: userId,
      arena_address: arena.walletAddress,
      to: destination.address,
      amount_usdc: amountUsdc,
      reference_id: referenceId,
      error: err instanceof Error ? err.message : String(err),
    });

    if (err instanceof PrivyNotConfiguredError) {
      throw new WithdrawUnavailableError("Custodial withdraw is not configured");
    }
    if (err instanceof PrivyApiError && isGasCreditsExhausted(err)) {
      // Operator-scoped sponsorship balance — we don't want to 500 the
      // user for an ops issue. Surfaces as 503 at the route layer.
      throw new WithdrawUnavailableError(
        "Gas sponsorship is temporarily exhausted, try again shortly",
      );
    }
    if (err instanceof PrivyTransactionFailedError) {
      throw new WithdrawFailedError(
        `Transaction ended in status ${err.status}`,
        err.transactionId,
        err.transactionHash,
      );
    }
    if (err instanceof PrivyTransactionTimeoutError) {
      throw new WithdrawFailedError(
        "Transaction did not confirm within 30s",
        err.transactionId,
        null,
      );
    }
    throw err;
  } finally {
    // Best-effort release. TTL handles a crashed worker.
    await redis.del(inflightKey).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type ArenaState = {
  walletAddress: string;
  privyWalletId: string;
};

function isGasCreditsExhausted(err: PrivyApiError): boolean {
  if (err.status !== 400) return false;
  return (
    err.body.includes("insufficient_funds") ||
    err.body.includes("gas credits")
  );
}

async function loadArenaState(userId: string): Promise<ArenaState> {
  const [{ data: wallet, error: walletErr }, { data: gladiator, error: glErr }] =
    await Promise.all([
      supabaseAdmin
        .from("arena_wallets")
        .select("wallet_address, privy_wallet_id")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("gladiators")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  if (walletErr) {
    throw new WithdrawUnavailableError(`Failed to read arena_wallets: ${walletErr.message}`);
  }
  if (glErr) {
    throw new WithdrawUnavailableError(`Failed to read gladiators: ${glErr.message}`);
  }
  if (!wallet?.wallet_address || !wallet.privy_wallet_id) {
    throw new ArenaWalletMissingError();
  }
  if (gladiator?.status !== "alive") {
    throw new GladiatorNotAliveError();
  }

  return {
    walletAddress: wallet.wallet_address,
    privyWalletId: wallet.privy_wallet_id,
  };
}

type ResolvedDestination = {
  address: Address;
  source: "verification" | "custody";
};

async function resolveDestination(
  userId: string,
  fid: number,
  arenaAddress: string,
): Promise<ResolvedDestination> {
  const arenaAddressLower = arenaAddress.toLowerCase();

  const { data, error } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("verifications")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new WithdrawUnavailableError(
      `Failed to read farcaster_accounts: ${error.message}`,
    );
  }

  const verifications = Array.isArray(data?.verifications)
    ? (data.verifications as unknown[])
    : [];

  for (const raw of verifications) {
    if (typeof raw !== "string") continue;
    if (!isAddress(raw)) continue;
    if (raw.toLowerCase() === arenaAddressLower) continue;
    return { address: getAddress(raw), source: "verification" };
  }

  // Fallback: resolve the custody address live via Neynar.
  const neynarUser = await fetchUser(String(fid)).catch((err) => {
    console.error("withdraw.neynar_lookup_failed", {
      user_id: userId,
      fid,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  const custody = neynarUser?.custody_address;
  if (
    typeof custody === "string" &&
    isAddress(custody) &&
    custody.toLowerCase() !== arenaAddressLower
  ) {
    return { address: getAddress(custody), source: "custody" };
  }

  throw new NoWithdrawDestinationError();
}
