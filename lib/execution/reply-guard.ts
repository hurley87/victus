import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { MissingSignerError, publishReplyCast } from "@/lib/neynar";

import { replyIdempotencyKey, type ReplyKind } from "./replies";
import { isUniqueViolation } from "./reserve";

/**
 * Workflow-safe replay guard for intent + outcome reply publishing.
 *
 * The step flow is:
 *
 *   1. Check `cast_replies` for an existing (cast_hash, reply_kind)
 *      row. If present, return early — the first attempt already
 *      published.
 *   2. Call `publishReplyCast` with the kind-specific Neynar
 *      idempotency key. Neynar dedupes on its side too; this is belt-
 *      and-braces for the common case where the step retries after
 *      Neynar acknowledged but before we persisted.
 *   3. Insert the `cast_replies` row. Unique constraint on
 *      (cast_hash, reply_kind) makes the insert idempotent across
 *      concurrent retries.
 *
 * Missing-signer is an operator-side config error: callers should
 * re-raise as `FatalError` so the workflow runtime doesn't burn six
 * retry budget on it.
 */

export type PublishReplyOnceParams = {
  castHash: string;
  kind: ReplyKind;
  text: string;
  embeds?: { url: string }[];
};

export type PublishReplyOnceResult = {
  replyCastHash: string | null;
  published: boolean;
};

export async function publishReplyOnce(
  params: PublishReplyOnceParams,
): Promise<PublishReplyOnceResult> {
  const existing = await loadExistingReply(params.castHash, params.kind);
  if (existing) {
    return { replyCastHash: existing, published: false };
  }

  let replyCastHash: string | null = null;
  try {
    const published = await publishReplyCast(
      params.castHash,
      params.text,
      replyIdempotencyKey(params.castHash, params.kind),
      params.embeds,
    );
    replyCastHash = published.hash;
  } catch (err) {
    if (err instanceof MissingSignerError) {
      // Caller decides whether to promote to FatalError. Re-throw.
      throw err;
    }
    throw err;
  }

  await recordReply(params.castHash, params.kind, replyCastHash);
  return { replyCastHash, published: true };
}

async function loadExistingReply(
  castHash: string,
  kind: ReplyKind,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("cast_replies")
    .select("reply_cast_hash")
    .eq("cast_hash", castHash)
    .eq("reply_kind", kind)
    .maybeSingle();

  if (error) throw new Error(`cast_replies lookup failed: ${error.message}`);
  return data?.reply_cast_hash ?? null;
}

async function recordReply(
  castHash: string,
  kind: ReplyKind,
  replyCastHash: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("cast_replies")
    .insert({
      cast_hash: castHash,
      reply_kind: kind,
      reply_cast_hash: replyCastHash,
    });

  if (error && !isUniqueViolation(error)) {
    // Unique violation means a concurrent retry won — safe to ignore.
    throw new Error(`cast_replies insert failed: ${error.message}`);
  }
}
