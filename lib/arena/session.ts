import "server-only";

import { NextResponse, type NextRequest } from "next/server";

export type ArenaSession = {
  fid: number;
  userId: string;
};

/**
 * Extract the authenticated session from request headers set by
 * `proxy.ts` after verifying the `auth_token` JWT. Returns an
 * `ArenaSession` on success, or a ready-to-return `NextResponse` with
 * a consistent 401 payload when the session is missing or malformed.
 */
export function requireSession(
  request: NextRequest,
): ArenaSession | NextResponse {
  const fid = request.headers.get("x-user-fid");
  const userId = request.headers.get("x-user-id");

  if (!fid || !userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const fidNumber = Number(fid);
  if (!Number.isFinite(fidNumber)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  return { fid: fidNumber, userId };
}
