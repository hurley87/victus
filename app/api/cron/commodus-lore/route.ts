import { NextResponse, type NextRequest } from "next/server";

import { publishNextCommodusLorePost } from "@/lib/commodus/lore/publisher";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (env.CRON_SECRET) {
    const provided = request.headers.get("authorization");
    if (provided !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const outcome = await publishNextCommodusLorePost();
    return NextResponse.json(outcome);
  } catch (err) {
    console.error("cron.commodus-lore failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
