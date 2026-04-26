import { NextResponse } from "next/server";

import { getRecentSeasonActivity } from "@/lib/seasons/leaderboard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getRecentSeasonActivity();
    return NextResponse.json(payload);
  } catch (err) {
    console.error("leaderboard/recent-activity failed", err);
    return NextResponse.json(
      { error: "Failed to load recent activity" },
      { status: 500 },
    );
  }
}
