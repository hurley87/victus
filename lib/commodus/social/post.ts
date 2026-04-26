import "server-only";

import { env } from "@/lib/env";
import { MissingSignerError, publishReplyCast } from "@/lib/neynar";
import { isUniqueViolation } from "@/lib/execution/reserve";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import type { SocialCastEvent } from "@/lib/workflows/commodus-social";

type SocialRunRow = Pick<
  Database["public"]["Tables"]["commodus_social_runs"]["Row"],
  "id" | "action" | "idem_key" | "posted_cast_hash"
>;

export type PublishCommodusSocialReplyParams = {
  runId: string;
  triggerCast: SocialCastEvent;
  replyText: string;
};

export type PublishCommodusSocialReplyResult = {
  postedCastHash: string | null;
  published: boolean;
};

/**
 * Publishes a generated Commodus social reply exactly once for a run row.
 *
 * The durable guard is `commodus_social_runs.idem_key`: webhook re-deliveries
 * land the same run row, then this helper observes `posted_cast_hash` before
 * calling Neynar. Neynar also receives the same idempotency key for retry cases
 * where the network publish succeeded but DB persistence did not finish.
 */
export async function publishCommodusSocialReplyOnce(
  params: PublishCommodusSocialReplyParams,
): Promise<PublishCommodusSocialReplyResult> {
  const run = await loadRunByIdemKey(params.runId);
  if (!run) {
    throw new Error(`commodus_social_runs missing for idem_key ${params.runId}`);
  }
  if (run.action !== "reply") {
    return { postedCastHash: run.posted_cast_hash, published: false };
  }

  if (run.posted_cast_hash) {
    await recordSelfCast({
      hash: run.posted_cast_hash,
      text: params.replyText,
      runId: params.runId,
      triggerCast: params.triggerCast,
    });
    return { postedCastHash: run.posted_cast_hash, published: false };
  }

  const published = await publishReplyCast(
    params.triggerCast.hash,
    params.replyText,
    params.runId,
  );

  await markRunPosted(run.id, published.hash);
  await recordSelfCast({
    hash: published.hash,
    text: published.text,
    runId: params.runId,
    triggerCast: params.triggerCast,
    authorFid: published.author_fid,
  });

  return { postedCastHash: published.hash, published: true };
}

async function loadRunByIdemKey(idemKey: string): Promise<SocialRunRow | null> {
  const { data, error } = await supabaseAdmin
    .from("commodus_social_runs")
    .select("id,action,idem_key,posted_cast_hash")
    .eq("idem_key", idemKey)
    .maybeSingle();

  if (error) throw new Error(`commodus_social_runs publish lookup failed: ${error.message}`);
  return data ?? null;
}

async function markRunPosted(id: string, postedCastHash: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("commodus_social_runs")
    .update({ posted_cast_hash: postedCastHash })
    .eq("id", id);

  if (error) throw new Error(`commodus_social_runs posted update failed: ${error.message}`);
}

async function recordSelfCast(params: {
  hash: string;
  text: string;
  runId: string;
  triggerCast: SocialCastEvent;
  authorFid?: number | null;
}): Promise<void> {
  const authorFid = validAuthorFid(params.authorFid) ?? env.COMMODUS_FID;
  if (!authorFid) {
    throw new MissingSignerError();
  }

  const { error } = await supabaseAdmin.from("commodus_casts").insert({
    hash: params.hash,
    thread_hash: params.triggerCast.thread_hash ?? params.triggerCast.hash,
    parent_hash: params.triggerCast.hash,
    parent_author_fid: params.triggerCast.author.fid,
    author_fid: authorFid,
    text: params.text,
    source: "self",
    raw_json: {
      source: "commodus_social_post",
      run_id: params.runId,
      reply_to_cast_hash: params.triggerCast.hash,
    } satisfies Json,
  });

  if (error && !isUniqueViolation(error)) {
    throw new Error(`commodus_casts self insert failed: ${error.message}`);
  }
}

function validAuthorFid(fid: number | null | undefined): number | undefined {
  return typeof fid === "number" && Number.isFinite(fid) && fid > 0
    ? fid
    : undefined;
}
