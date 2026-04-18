import { NextRequest, NextResponse } from "next/server";

import { getArenaProfile } from "@/lib/arena/service";
import { requireSession } from "@/lib/arena/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const profile = await getArenaProfile(session.userId, session.fid);
    return NextResponse.json(profile);
  } catch (err) {
    console.error("Failed to load arena profile", err);
    return NextResponse.json(
      { error: "Failed to load arena profile" },
      { status: 500 },
    );
  }
}
