import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { reconcileStuckExecutions } from "@/lib/execution/reconciler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Cron invocation for the execution reconciler.
 *
 * Schedule: `*\/5 * * * *` (every 5 minutes) — configured in
 * `vercel.json`. Vercel attaches an `Authorization: Bearer
 * ${CRON_SECRET}` header to cron invocations; we reject anything
 * else to prevent the route being hit from the public internet.
 */
export async function GET(request: NextRequest) {
  if (env.CRON_SECRET) {
    const provided = request.headers.get("authorization");
    if (provided !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const outcome = await reconcileStuckExecutions();
    if (outcome.errors.length > 0) {
      console.warn("cron.reconcile.partial", outcome);
    }
    return NextResponse.json(outcome);
  } catch (err) {
    console.error("cron.reconcile failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
