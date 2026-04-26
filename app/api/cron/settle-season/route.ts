import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { settleSeason } from "@/lib/seasons/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleSettleSeasonCron(request);
}

export async function GET(request: NextRequest) {
  return handleSettleSeasonCron(request);
}

async function handleSettleSeasonCron(request: NextRequest) {
  if (env.CRON_SECRET) {
    const provided = request.headers.get("authorization");
    if (provided !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const outcome = await settleSeason();
    return NextResponse.json(outcome);
  } catch (err) {
    console.error("cron.settle-season failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
