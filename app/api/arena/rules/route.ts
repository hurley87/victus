import { NextResponse } from "next/server";

import { getPublicArenaRules } from "@/lib/arena/service";

export const dynamic = "force-dynamic";

/**
 * Public rules + whitelist snapshot for the Rules page and other display
 * surfaces. Same enforcement payload shape as `ArenaRules` on `/api/arena/me`
 * for users without a wallet policy row.
 */
export async function GET() {
  try {
    const rules = await getPublicArenaRules();
    return NextResponse.json(rules);
  } catch (err) {
    console.error("Failed to load public arena rules", err);
    return NextResponse.json(
      { error: "Failed to load arena rules" },
      { status: 500 },
    );
  }
}
