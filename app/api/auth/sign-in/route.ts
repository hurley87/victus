import { Errors, createClient } from "@farcaster/quick-auth";

import { env } from "@/lib/env";
import { fetchUser } from "@/lib/neynar";
import { resolveOrCreateFarcasterUser } from "@/lib/auth/user-service";
import type { AuthenticatedUser } from "@/lib/auth/types";
import * as jose from "jose";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const quickAuthClient = createClient();

const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const POST = async (req: NextRequest) => {
  const body = (await req.json()) as {
    token?: string;
    referrerFid?: number;
  };
  const farcasterToken = body.token;

  if (!farcasterToken) {
    return NextResponse.json(
      { success: false, error: "Missing Quick Auth token" },
      { status: 400 },
    );
  }

  let fid: number | undefined;
  let expirationTime: number | undefined;

  try {
    const payload = await quickAuthClient.verifyJwt({
      domain: new URL(env.NEXT_PUBLIC_URL).hostname,
      token: farcasterToken,
    });

    if (payload?.sub) {
      fid = Number(payload.sub);
      expirationTime = payload.exp;
    }
  } catch (e) {
    if (e instanceof Errors.InvalidTokenError) {
      console.error("Invalid Quick Auth token", e);
    } else {
      console.error("Error verifying Quick Auth token", e);
    }
  }

  if (!fid) {
    return NextResponse.json(
      { success: false, error: "Invalid token" },
      { status: 401 },
    );
  }

  const profile = await fetchUser(fid.toString());

  let userId: string;
  try {
    userId = await resolveOrCreateFarcasterUser(fid, profile, body.referrerFid);
  } catch (err) {
    console.error("Failed to persist Farcaster user", err);
    return NextResponse.json(
      { success: false, error: "Failed to persist user" },
      { status: 500 },
    );
  }

  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const expSeconds =
    expirationTime ?? Math.floor(Date.now() / 1000) + DEFAULT_SESSION_TTL_SECONDS;

  const token = await new jose.SignJWT({ fid, user_id: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expSeconds)
    .sign(secret);

  const user: AuthenticatedUser = { ...profile, user_id: userId };

  const response = NextResponse.json({ success: true, user });

  const maxAgeSeconds = Math.max(
    1,
    expSeconds - Math.floor(Date.now() / 1000),
  );

  response.cookies.set({
    name: "auth_token",
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: maxAgeSeconds,
    path: "/",
  });

  return response;
};
