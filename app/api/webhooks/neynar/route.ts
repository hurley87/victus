import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { env } from "@/lib/env";
import { ratelimit, wasProcessed } from "@/lib/redis";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  type CommandContext,
  handleCommodusCommand,
} from "@/lib/workflows/commodus-command";

export const runtime = "nodejs";

/** 60s covers Neynar's retry window; durable dedupe is the cast_hash UNIQUE. */
const CAST_DEDUPE_TTL_SECONDS = 60;

/**
 * Neynar `cast.created` webhook → durable Commodus command pipeline.
 *
 * This route is the single ingress for the durable execution pipeline
 * described in PRD § Durable Execution Architecture (and issue #8). It
 * is deliberately a pure intake: the only work done synchronously is
 * authentication, rate limiting, and idempotency + landing-row
 * bookkeeping. Every downstream step — parse, policy, quote, Privy
 * submit, verify, score, reply — runs in the `process-trade-command`
 * workflow so the webhook can ACK 200 in under 100 ms.
 *
 * Defense-in-depth ordering:
 *   1. Read raw body (required for HMAC verification).
 *   2. Verify HMAC-SHA512 signature against NEYNAR_WEBHOOK_SECRET.
 *   3. Parse JSON only after signature passes.
 *   4. Rate-limit per author FID to shield downstream paid APIs.
 *   5. Fast idempotency guard via Redis SETNX cast:{hash} TTL 60s.
 *   6. Durable idempotency via cast_commands unique (cast_hash).
 *   7. Hand off to the workflow runtime and ack 200.
 *
 * Named-queue note: issue #8 calls for a named Vercel Queue
 * `trade-commands` with `idempotency_key = cast_hash`. The workflow
 * SDK v4.2.4 used here does not expose `idempotencyKey` on `start()`;
 * the Vercel Workflow runtime is itself the durable queue. Idempotency
 * is layered at the webhook (Redis SETNX + cast_commands UNIQUE),
 * workflow (`load_command` short-circuits terminal statuses), reserve
 * (`trade_executions.execution_id` UNIQUE), and chain
 * (`trade_executions.tx_hash` / `fee_tx_hash` UNIQUE) levels. If the
 * SDK exposes an `idempotencyKey` option in a later release, wire it
 * here; until then the layered guards cover the same correctness
 * surface.
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

  // Guard: our own replies (Neynar re-broadcasts casts we publish). Drop
  // before we spend Redis/DB budget on them.
  if (env.COMMODUS_FID && author.fid === env.COMMODUS_FID) {
    return NextResponse.json({ self: true });
  }

  const { success } = await ratelimit.webhook.limit(`fid:${author.fid}`);
  if (!success) {
    return new NextResponse("Rate limited", { status: 429 });
  }

  if (await wasProcessed(`cast:${hash}`, CAST_DEDUPE_TTL_SECONDS)) {
    return NextResponse.json({ duplicate: true });
  }

  // Durable landing row. `upsert` + `ignoreDuplicates` makes a race with a
  // concurrent delivery a no-op rather than a 500.
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
    // Don't leak webhook state to Neynar — return 500 so they retry, but log
    // loudly. Redis dedupe key will expire in 60s, so retry can proceed.
    console.error("cast_commands upsert failed", { hash, error });
    return new NextResponse("Database error", { status: 500 });
  }

  const ctx: CommandContext = {
    castHash: hash,
    authorFid: author.fid,
    text,
    parentHash: parent_hash ?? null,
  };

  // Fire-and-forget: the workflow runtime owns durability from here. We do
  // NOT await any downstream work inside the webhook — 200 ASAP.
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
