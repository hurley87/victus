import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseOptionalJsonBody } from "@/lib/arena/http";
import { requireSession } from "@/lib/arena/session";
import type {
  MintGladiatorRequest,
  MintGladiatorResponse,
} from "@/lib/arena/types";
import {
  GladiatorMintUnavailableError,
  GladiatorNameTakenError,
  InvalidGladiatorNameError,
  mintGladiator,
} from "@/lib/gladiators/service";

export const dynamic = "force-dynamic";

// Name is optional: when absent, the service derives it from the user's
// Farcaster username. Kept as an accepted field for forward compat with a
// future "rename" admin tool or custom-name UI, without churning the wire
// contract.
const bodySchema = z
  .object({
    name: z.string().min(1).optional(),
  })
  .optional() satisfies z.ZodType<MintGladiatorRequest | undefined>;

export async function POST(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  const parsed = await parseOptionalJsonBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await mintGladiator({
      userId: session.userId,
      fid: session.fid,
      name: parsed.data?.name,
    });

    if (!result.replayed) {
      console.info("gladiator.minted", {
        user_id: session.userId,
        gladiator_id: result.gladiator.id,
        arena_address: result.arena_address,
      });
    }

    const body: MintGladiatorResponse = {
      arena_address: result.arena_address,
      gladiator: {
        name: result.gladiator.name,
        status: result.gladiator.status,
        minted_at: result.gladiator.minted_at,
        funded_at: result.gladiator.funded_at,
      },
      min_mint_deposit_usdc: result.min_mint_deposit_usdc,
    };

    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof InvalidGladiatorNameError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof GladiatorNameTakenError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof GladiatorMintUnavailableError) {
      console.error("Gladiator mint unavailable", err);
      return NextResponse.json(
        { error: "Mint temporarily unavailable, try again shortly" },
        { status: 503 },
      );
    }
    console.error("Unexpected mint error", err);
    return NextResponse.json(
      { error: "Unexpected mint error" },
      { status: 500 },
    );
  }
}
