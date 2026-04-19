import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { reconcileStuckExecutions } from "@/lib/execution/reconciler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Out-of-band reconciler trigger. Runs the same path Vercel Cron hits
 * every 5 minutes so an on-call can clear a stuck queue without
 * waiting for the next tick.
 *
 * Auth: `Authorization: Bearer ${ADMIN_API_TOKEN}`. No session /
 * cookie surface — this is intentionally out-of-band from the
 * user-facing auth posture.
 */
export async function POST(request: NextRequest) {
  if (!env.ADMIN_API_TOKEN) {
    return NextResponse.json(
      { error: "ADMIN_API_TOKEN not configured" },
      { status: 503 },
    );
  }

  const provided = request.headers.get("authorization");
  const expected = `Bearer ${env.ADMIN_API_TOKEN}`;
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await reconcileStuckExecutions();
    return NextResponse.json(outcome);
  } catch (err) {
    console.error("admin.reconcile failed", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
