import { NextRequest, NextResponse } from "next/server";

import { fetchUser } from "@/lib/neynar";
import type { AuthenticatedUser } from "@/lib/auth/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const fid = request.headers.get("x-user-fid");
  const userId = request.headers.get("x-user-id");

  if (!fid || !userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const profile = await fetchUser(fid);
  const user: AuthenticatedUser = { ...profile, user_id: userId };

  return NextResponse.json(user);
}
