import { NextResponse, type NextRequest } from "next/server";

import { defaultDailySlotKey, runCommodusAutotrader } from "@/lib/commodus/autotrader/run";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Cron: daily Commodus autotrader (1 trade max per run, idempotent by slot key).
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(request: NextRequest) {
  if (env.CRON_SECRET) {
    const provided = request.headers.get("authorization");
    if (provided !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dryRun") === "1" || searchParams.get("dry_run") === "1";
  const slotKey = searchParams.get("slotKey") ?? defaultDailySlotKey();

  try {
    const outcome = await runCommodusAutotrader({ slotKey, dryRun });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    console.error("cron.commodus-autotrade failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
