import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import {
  replayCommodusSocialTrigger,
  ReplayInputError,
  ReplayNotFoundError,
} from "@/lib/commodus/social/replay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReplayRequestSchema = z.object({
  trigger_cast_hash: z.string().min(1),
});

/**
 * Local operator replay for Commodus social runs.
 * Auth: `Authorization: Bearer ${ADMIN_API_TOKEN}`.
 */
export async function POST(request: NextRequest) {
  if (!env.ADMIN_API_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "ADMIN_API_TOKEN is not configured" },
      { status: 501 },
    );
  }

  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${env.ADMIN_API_TOKEN}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ReplayRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "trigger_cast_hash is required" },
      { status: 400 },
    );
  }

  try {
    const result = await replayCommodusSocialTrigger(parsed.data.trigger_cast_hash);
    return NextResponse.json({
      ok: true,
      original_run_id: result.originalRunId,
      new_run_id: result.newRunId,
      trigger_cast_hash: result.triggerCastHash,
      action: result.action,
      reason: result.reason,
      score: result.score,
      draft: result.draft,
      risk_flags: result.riskFlags,
    });
  } catch (err) {
    if (err instanceof ReplayInputError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    if (err instanceof ReplayNotFoundError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 404 });
    }

    console.error("admin.commodus-social.replay", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
