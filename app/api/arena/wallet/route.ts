import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/lib/arena/session";
import type { ProvisionArenaWalletResponse } from "@/lib/arena/types";
import {
  ArenaWalletProvisionError,
  provisionArenaWallet,
} from "@/lib/arena/wallet";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  try {
    const result = await provisionArenaWallet({ userId: session.userId });

    if (!result.replayed) {
      console.info("arena_wallet.provisioned", {
        user_id: session.userId,
        wallet_id: result.wallet.id,
        arena_address: result.arena_address,
      });
    }

    const body: ProvisionArenaWalletResponse = {
      arena_address: result.arena_address,
      wallet: {
        status: result.wallet.status,
        created_at: result.wallet.created_at,
        funded_at: result.wallet.funded_at,
      },
      min_funding_deposit_usdc: result.min_funding_deposit_usdc,
    };

    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof ArenaWalletProvisionError) {
      if (err.status >= 500) console.error(err.name, err);
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }

    console.error("Unexpected arena wallet provisioning error", err);
    return NextResponse.json(
      { error: "Unexpected arena wallet provisioning error" },
      { status: 500 },
    );
  }
}
