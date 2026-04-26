import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/arena/session";
import { getReferralSummary } from "@/lib/referrals/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  try {
    const payload = await getReferralSummary({
      userId: session.userId,
      fid: session.fid,
    });
    return NextResponse.json(payload);
  } catch (err) {
    console.error("referrals/me failed", err);
    return NextResponse.json(
      { error: "Failed to load referrals" },
      { status: 500 },
    );
  }
}
