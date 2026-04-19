/**
 * Reply-kind idempotency helpers for the durable pipeline.
 *
 * The workflow publishes two replies per cast: an `intent` decree right
 * after the quote is reserved, and an `outcome` decree after the swap
 * confirms (or fails). Both must survive a workflow replay: if a step
 * retries after Neynar accepted the publish but before we returned,
 * the retry must be a true no-op.
 *
 * Two layers handle this:
 *
 *   1. Neynar's `idempotency-key` header — different per reply kind so
 *      the intent cast cannot preempt the outcome cast via a key
 *      collision.
 *   2. A `cast_replies` row — inserted via check-then-insert. If the
 *      row exists, the workflow step skips the Neynar call entirely.
 *      This saves a network round trip on replays and gives us a DB-
 *      level audit of which replies went out.
 */

export type ReplyKind = "intent" | "outcome";

/** Idempotency key passed to Neynar's `POST /cast` header + body. */
export function replyIdempotencyKey(
  castHash: string,
  kind: ReplyKind,
): string {
  return `reply:${castHash}:${kind}`;
}
