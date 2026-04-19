import { NextResponse } from "next/server";

import { getCurrentMonthLeaderboard } from "@/lib/leaderboard/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getCurrentMonthLeaderboard();
    return NextResponse.json(payload);
  } catch (err) {
    console.error("leaderboard/current failed", err);
    return NextResponse.json(
      { error: "Failed to load leaderboard" },
      { status: 500 },
    );
  }
}
