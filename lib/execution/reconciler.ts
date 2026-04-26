import "server-only";

import type { Hex } from "viem";

import { basePublicClient } from "@/lib/chain/client";
import {
  getTransaction,
  PrivyApiError,
  type PrivyTransaction,
} from "@/lib/privy/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { log } from "@/lib/logger";

/**
 * Best-effort reconciler for trade_executions stuck in a non-terminal
 * state past the 15-minute SLA.
 *
 * The issue-#8 vision scans Base for swaps that match `execution_id`'s
 * expected pair + notional and back-populates the row. This module
 * implements a tighter, more reliable subset that's enough to unstick
 * the common failure modes seen in practice:
 *
 *   1. `submitted` row with a Privy transaction id but no `tx_hash`:
 *      call Privy `getTransaction(id)` to pull the final hash. Terminal
 *      success → populate `tx_hash`. Terminal failure → mark
 *      `reverted` / `failed` with reason.
 *   2. `submitted` row with `tx_hash` but no `confirmed_at`: read the
 *      Base receipt; on success flip to `confirmed`, on revert flip to
 *      `reverted`.
 *   3. Stale `pending`/`submitted` row with no `privy_transaction_id`
 *      and no `tx_hash` (e.g. workflow failed before sign, or Privy
 *      misconfig): no recovery path. Mark `failed` with
 *      `failure_reason` so the row leaves the reconciler queue.
 *
 * A broader on-chain-scan fallback is deliberately deferred. The
 * scenarios that require it (Privy handle lost + tx hash lost) are
 * unreachable unless we drop the Privy transaction id, which this
 * pipeline never does.
 */

/** Rows older than this are candidates for reconciliation. */
export const RECONCILE_STALE_MS = 15 * 60 * 1_000;

export type ReconcileOutcome = {
  inspected: number;
  resolved: number;
  stillStuck: number;
  errors: Array<{ executionId: string; error: string }>;
};

export async function reconcileStuckExecutions(params?: {
  now?: Date;
  staleMs?: number;
}): Promise<ReconcileOutcome> {
  const now = params?.now ?? new Date();
  const staleMs = params?.staleMs ?? RECONCILE_STALE_MS;
  const cutoff = new Date(now.getTime() - staleMs).toISOString();

  const { data, error } = await supabaseAdmin
    .from("trade_executions")
    .select("id, execution_id, status, tx_hash, privy_transaction_id, created_at")
    .in("status", ["pending", "submitted"])
    .lt("created_at", cutoff)
    .limit(50);

  if (error) {
    throw new Error(`reconciler: trade_executions query failed: ${error.message}`);
  }

  const outcome: ReconcileOutcome = {
    inspected: data.length,
    resolved: 0,
    stillStuck: 0,
    errors: [],
  };

  for (const row of data) {
    try {
      const progress = await reconcileOne(row);
      if (progress) outcome.resolved += 1;
      else outcome.stillStuck += 1;
    } catch (err) {
      outcome.errors.push({
        executionId: row.execution_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return outcome;
}

type StuckRow = {
  id: string;
  execution_id: string;
  status: string;
  tx_hash: string | null;
  privy_transaction_id: string | null;
  created_at: string;
};

/** Returns true if the row moved forward as a result of this pass. */
async function reconcileOne(row: StuckRow): Promise<boolean> {
  // Case 2: we have a hash; just finish verification.
  if (row.tx_hash) {
    return await verifyAndMark(row.id, row.tx_hash);
  }

  // Case 1: we have a Privy id — ask Privy for the hash.
  if (row.privy_transaction_id) {
    const tx = await safeGetPrivyTransaction(row.privy_transaction_id);
    if (!tx) return false;

    if (tx.transaction_hash && (tx.status === "confirmed" || tx.status === "finalized")) {
      await supabaseAdmin
        .from("trade_executions")
        .update({ tx_hash: tx.transaction_hash })
        .eq("id", row.id);
      return await verifyAndMark(row.id, tx.transaction_hash);
    }

    if (isPrivyTerminalFailure(tx.status)) {
      await supabaseAdmin
        .from("trade_executions")
        .update({
          status: "failed",
          tx_hash: tx.transaction_hash ?? null,
        })
        .eq("id", row.id);
      return true;
    }

    return false;
  }

  // Case 3: no chain hash and no Privy id — cannot poll either layer.
  const { error: failError } = await supabaseAdmin
    .from("trade_executions")
    .update({
      status: "failed",
      failure_reason:
        "reconciler: no Privy transaction id and no tx hash after SLA (abandoned reserve)",
    })
    .eq("id", row.id);

  if (failError) {
    throw new Error(`reconciler: mark failed (no privy handle): ${failError.message}`);
  }

  log.info("reconciler.pending_with_no_privy_handle_marked_failed", {
    executionId: row.execution_id,
    tradeExecutionId: row.id,
    createdAt: row.created_at,
  });
  return true;
}

async function verifyAndMark(
  tradeExecutionId: string,
  txHash: string,
): Promise<boolean> {
  const receipt = await basePublicClient
    .getTransactionReceipt({ hash: txHash as Hex })
    .catch(() => null);

  if (!receipt) return false;

  const update = receipt.status === "success"
    ? { status: "confirmed", confirmed_at: new Date().toISOString() }
    : { status: "reverted" };

  const { error } = await supabaseAdmin
    .from("trade_executions")
    .update(update)
    .eq("id", tradeExecutionId);

  if (error) {
    throw new Error(`reconciler: update failed: ${error.message}`);
  }

  return true;
}

async function safeGetPrivyTransaction(
  transactionId: string,
): Promise<PrivyTransaction | null> {
  try {
    return await getTransaction(transactionId);
  } catch (err) {
    // 404 from Privy means the id is invalid — nothing we can do.
    if (err instanceof PrivyApiError && err.status === 404) return null;
    throw err;
  }
}

function isPrivyTerminalFailure(status: string): boolean {
  return (
    status === "execution_reverted" ||
    status === "failed" ||
    status === "provider_error" ||
    status === "replaced"
  );
}
