import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { provisionCommodusPlayer } from "@/lib/commodus/autotrader/player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time: creates the Commodus system user + Farcaster link + Privy arena wallet + policy row.
 * Auth: `Authorization: Bearer ${ADMIN_API_TOKEN}`.
 */
export async function POST(request: NextRequest) {
  if (!env.ADMIN_API_TOKEN) {
    return NextResponse.json(
      { error: "ADMIN_API_TOKEN is not configured" },
      { status: 501 },
    );
  }
  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${env.ADMIN_API_TOKEN}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await provisionCommodusPlayer();
    return NextResponse.json({ ok: true, created: result.created, player: result.player });
  } catch (err) {
    console.error("admin.commodus.bootstrap", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
