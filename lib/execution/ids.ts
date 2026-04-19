import { createHash } from "node:crypto";

/**
 * Deterministic `execution_id` derivation from a Farcaster cast hash.
 *
 * The execution_id is the reserve-before-submit idempotency key: it is
 * inserted onto `trade_executions` with `status='pending'` BEFORE the
 * Privy signing call, so a workflow replay that re-enters `quote_swap`
 * with the same cast observes the existing row (via the unique
 * constraint) and skips straight to `submit_swap` — or, if `tx_hash` is
 * already populated, to `verify_tx_onchain`. This is the mechanism that
 * prevents a double-submit if the workflow crashes between reserve and
 * Privy's response (issue #8 § Idempotency layers).
 *
 * Design:
 * - SHA-256 over `exec:v1:{castHash}`. The `exec:v1:` domain separator
 *   leaves room for a future schema (`exec:v2:...`) without collision.
 * - Lowercased 32-char prefix of the hex digest. 32 hex chars = 128 bits
 *   of entropy, which is overkill for uniqueness against the expected
 *   daily cast volume but gives us margin for future products.
 * - Non-empty cast hash enforced so a missing payload field can't sneak
 *   a real row into Postgres with a garbage id.
 */
export function deriveExecutionId(castHash: string): string {
  if (!castHash || typeof castHash !== "string") {
    throw new Error("deriveExecutionId: castHash is required");
  }

  const digest = createHash("sha256")
    .update(`exec:v1:${castHash}`)
    .digest("hex");

  return digest.slice(0, 32);
}
