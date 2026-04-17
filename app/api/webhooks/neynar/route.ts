import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { env } from "@/lib/env";
import { ratelimit, wasProcessed } from "@/lib/redis";
import {
  type CommandContext,
  handleCommodusCommand,
} from "@/lib/workflows/commodus-command";

export const runtime = "nodejs";

/**
 * Neynar `cast.created` webhook → Commodus command workflow.
 *
 * Defense-in-depth ordering:
 *  1. Read raw body (required for HMAC verification).
 *  2. Verify HMAC-SHA512 signature against NEYNAR_WEBHOOK_SECRET.
 *  3. Parse JSON only after signature passes.
 *  4. Rate-limit per author FID to shield downstream paid APIs.
 *  5. Idempotency check by cast hash (Neynar retries on 5xx).
 *  6. Start durable workflow and ack 200 fast.
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
    // Neynar may deliver other types if the webhook is broadened later.
    return NextResponse.json({ ignored: true });
  }

  const { hash, author, text, parent_hash } = event.data;

  const { success } = await ratelimit.webhook.limit(`fid:${author.fid}`);
  if (!success) {
    return new NextResponse("Rate limited", { status: 429 });
  }

  if (await wasProcessed(`neynar:cast:${hash}`)) {
    return NextResponse.json({ duplicate: true });
  }

  const ctx: CommandContext = {
    castHash: hash,
    authorFid: author.fid,
    text,
    parentHash: parent_hash ?? null,
  };

  await start(handleCommodusCommand, [ctx]);

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
    parent_hash: string | null;
    author: { fid: number };
  };
}
