import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { env } from "@/lib/env";
import { ratelimit, wasProcessed } from "@/lib/redis";
import { supabaseAdmin } from "@/lib/supabase/server";
import { log } from "@/lib/logger";
import {
  type CommandContext,
  handleCommodusCommand,
} from "@/lib/workflows/commodus-command";
import { deriveIdemKey } from "@/lib/workflows/commodus-social-idem";
import {
  handleSocialEngagement,
  type SocialEngagementContext,
} from "@/lib/workflows/commodus-social";
import { routeCast } from "@/lib/workflows/route-cast";

export const runtime = "nodejs";

/** Covers Neynar retries; durable dedupe remains `cast_commands.cast_hash` UNIQUE. */
const CAST_DEDUPE_TTL_SECONDS = 60;

/**
 * Neynar `cast.created`: verify HMAC, rate-limit, Redis dedupe, land `cast_commands`,
 * then `start()` trade + social workflows. Parse/execute/reply stay in workflows so
 * this handler returns quickly.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-neynar-signature");

  if (!signature || !verifySignature(rawBody, signature, env.NEYNAR_WEBHOOK_SECRET)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let event: NeynarCastCreatedEvent;
  try {
    event = JSON.parse(rawBody) as NeynarCastCreatedEvent;
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  if (event.type !== "cast.created") {
    return NextResponse.json({ ignored: true });
  }

  const { hash, author, text, parent_hash } = event.data;

  // Neynar re-delivers bot-authored casts; skip before Redis/DB work.
  if (env.COMMODUS_FID && author.fid === env.COMMODUS_FID) {
    log.info("skip:self-reply", { castHash: hash, fid: author.fid });
    return NextResponse.json({ self: true });
  }

  const { success } = await ratelimit.webhook.limit(`fid:${author.fid}`);
  if (!success) {
    log.warn("rate-limited", { castHash: hash, fid: author.fid });
    return new NextResponse("Rate limited", { status: 429 });
  }

  if (await wasProcessed(`cast:${hash}`, CAST_DEDUPE_TTL_SECONDS)) {
    log.info("skip:duplicate", { castHash: hash, fid: author.fid });
    return NextResponse.json({ duplicate: true });
  }

  const { error } = await supabaseAdmin
    .from("cast_commands")
    .upsert(
      {
        fid: author.fid,
        cast_hash: hash,
        text,
        status: "received",
      },
      { onConflict: "cast_hash", ignoreDuplicates: true },
    );

  if (error) {
    log.error("cast_commands_upsert_failed", {
      castHash: hash,
      fid: author.fid,
      err: error.message,
      code: error.code,
    });
    return new NextResponse("Database error", { status: 500 });
  }

  const ctx: CommandContext = {
    castHash: hash,
    authorFid: author.fid,
    text,
    parentHash: parent_hash ?? null,
  };

  const route = routeCast(text);
  if (route === "trade") {
    await start(handleCommodusCommand, [ctx]);
  } else {
    const socialCtx: SocialEngagementContext = {
      runId: deriveIdemKey(hash, "webhook"),
      triggerHash: hash,
      runType: "webhook",
      cast: event.data,
    };
    await start(handleSocialEngagement, [socialCtx]);
  }

  log.info("accepted", { castHash: hash, fid: author.fid, route });
  return NextResponse.json({ accepted: true });
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha512", secret).update(body).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface NeynarCastCreatedEvent {
  type: string;
  data: {
    hash: string;
    text: string;
    thread_hash?: string | null;
    parent_hash: string | null;
    parent_author?: { fid: number | null } | null;
    author: { fid: number; username?: string | null };
    mentioned_profiles?: Array<{ fid: number }> | null;
    embeds?: Array<{ url?: string; cast_id?: { hash?: string; fid?: number } | null }> | null;
  };
}
