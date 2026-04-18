import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  AddressAlreadyClaimedError,
  AddressNotVerifiedError,
  InvalidAddressError,
  designateArenaAddress,
} from "@/lib/arena/service";
import { requireSession } from "@/lib/arena/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  address: z.string().min(1, "Missing address"),
});

export async function POST(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) {
    return session;
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  try {
    const arenaAddress = await designateArenaAddress({
      userId: session.userId,
      fid: session.fid,
      address: parsed.data.address,
    });
    return NextResponse.json({ arena_address: arenaAddress });
  } catch (err) {
    if (err instanceof InvalidAddressError) {
      return NextResponse.json(
        { error: "Invalid Ethereum address" },
        { status: 400 },
      );
    }
    if (err instanceof AddressNotVerifiedError) {
      return NextResponse.json(
        {
          error:
            "Address is not one of your Farcaster-verified addresses",
        },
        { status: 403 },
      );
    }
    if (err instanceof AddressAlreadyClaimedError) {
      return NextResponse.json(
        { error: "Address is already designated by another account" },
        { status: 409 },
      );
    }
    console.error("Failed to designate arena address", err);
    return NextResponse.json(
      { error: "Failed to designate arena address" },
      { status: 500 },
    );
  }
}
