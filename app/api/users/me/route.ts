import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/arena/session";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { fetchUser } from "@/lib/neynar";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  const profile = await fetchUser(String(session.fid));
  const user: AuthenticatedUser = { ...profile, user_id: session.userId };

  return NextResponse.json(user);
}
