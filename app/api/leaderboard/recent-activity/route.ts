import { NextResponse } from "next/server";

import { getRecentActivity } from "@/lib/leaderboard/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getRecentActivity();
    return NextResponse.json(payload);
  } catch (err) {
    console.error("leaderboard/recent-activity failed", err);
    return NextResponse.json(
      { error: "Failed to load recent activity" },
      { status: 500 },
    );
  }
}
