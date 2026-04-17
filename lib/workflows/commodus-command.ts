import { FatalError } from "workflow";

import { MissingSignerError, publishReplyCast } from "@/lib/neynar";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Payload forwarded from the Neynar `cast.created` webhook into the workflow.
 * Kept narrow on purpose: anything extra should be fetched lazily inside a
 * step so the event log stays small and serializable.
 */
export interface CommandContext {
  castHash: string;
  /** FID of the user who mentioned the bot. */
  authorFid: number;
  /** Raw cast text (what the user typed). */
  text: string;
  /** Optional parent cast hash if this is a reply. */
  parentHash: string | null;
}

/**
 * Tracer reply — deterministic, in-voice, short. Every `@commodus` mention
 * gets this while we prove out signature verification + managed-signer
 * publishing end-to-end (issue #3).
 *
 * Later issues (#6 parse, #7 execute, …) will branch on parsed intent and
 * replace this with templated trade/status/rejection copy.
 */
const TRACER_REPLY = "Hail, gladiator. Commodus hears thee.";

/**
 * Top-level workflow for a Commodus mention.
 *
 * For the tracer (issue #3) this is deliberately minimal: log the receipt,
 * publish a hardcoded reply, and mark the command done. The full
 * parse/validate/quote/execute/record pipeline arrives in later issues and
 * will slot in between `markReceived` and `publishTracerReply`.
 */
export async function handleCommodusCommand(ctx: CommandContext) {
  "use workflow";

  await markStatus(ctx.castHash, "received");

  await publishTracerReply(ctx.castHash);

  await markStatus(ctx.castHash, "executed");

  return { status: "tracer_replied" as const };
}

/**
 * Idempotent status transition on `cast_commands`. Safe to retry: a newer
 * status does not clobber a terminal one (`executed`/`failed`/`rejected`).
 */
async function markStatus(
  castHash: string,
  status: "received" | "executed" | "failed",
): Promise<void> {
  "use step";

  const { error } = await supabaseAdmin
    .from("cast_commands")
    .update({ status })
    .eq("cast_hash", castHash)
    .not("status", "in", "(executed,failed,rejected)");

  if (error) {
    throw new Error(`cast_commands update failed: ${error.message}`);
  }
}

/**
 * Publish the tracer reply via the Neynar managed signer.
 *
 * - Idempotency key is derived from the parent cast hash, so workflow
 *   retries (or duplicate webhook deliveries that slip past Redis + the
 *   DB unique) won't double-post.
 * - Missing signer config surfaces as `FatalError` — no point retrying a
 *   config error 6×.
 */
async function publishTracerReply(parentCastHash: string): Promise<void> {
  "use step";

  try {
    await publishReplyCast(
      parentCastHash,
      TRACER_REPLY,
      `tracer:${parentCastHash}`,
    );
  } catch (err) {
    if (err instanceof MissingSignerError) {
      throw new FatalError(err.message);
    }
    throw err;
  }
}
