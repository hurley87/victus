import * as jose from "jose";
import { NextRequest, NextResponse } from "next/server";
import { env } from "./lib/env";

export const config = {
  matcher: ["/api/:path*"],
};

// JWT_SECRET is immutable for the lifetime of the runtime; encode once
// instead of per-request to avoid an allocation on every authed API hit.
const JWT_SECRET_BYTES = new TextEncoder().encode(env.JWT_SECRET);

export default async function proxy(req: NextRequest) {
  // Skip the session-cookie check for endpoints that authenticate
  // themselves (sign-in exchanges a Farcaster Quick Auth token for our
  // cookie; webhooks verify an HMAC signature; OG routes are public).
  if (
    req.nextUrl.pathname === "/api/auth/sign-in" ||
    req.nextUrl.pathname.includes("/api/og") ||
    req.nextUrl.pathname.includes("/api/webhook")
  ) {
    return NextResponse.next();
  }

  // Get token from auth_token cookie
  const token = req.cookies.get("auth_token")?.value;

  if (!token) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET_BYTES);

    const fid = payload.fid;
    const userId = payload.user_id;

    if (typeof fid !== "number" && typeof fid !== "string") {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    if (typeof userId !== "string" || userId.length === 0) {
      // Session predates the user_id claim — force re-auth so the client
      // mints a new token carrying a resolved Supabase user_id.
      return NextResponse.json(
        { error: "Session requires re-authentication" },
        { status: 401 },
      );
    }

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-fid", String(fid));
    requestHeaders.set("x-user-id", userId);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}
