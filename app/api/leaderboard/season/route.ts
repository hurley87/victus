import { NextResponse } from "next/server";

import { getSeasonLeaderboard } from "@/lib/seasons/leaderboard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getSeasonLeaderboard();
    return NextResponse.json(payload);
  } catch (err) {
    console.error("leaderboard/season failed", err);
    return NextResponse.json(
      { error: "Failed to load season leaderboard" },
      { status: 500 },
    );
  }
}
