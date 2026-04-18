import * as jose from "jose";
import { NextRequest, NextResponse } from "next/server";
import { env } from "./lib/env";

export const config = {
  matcher: ["/api/:path*"],
};

export default async function proxy(req: NextRequest) {
  // Skip auth check for sign-in endpoint
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
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);

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
