import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseOptionalJsonBody } from "@/lib/arena/http";
import { requireSession } from "@/lib/arena/session";
import {
  FundingSourceError,
  verifyAndSaveFundingSource,
} from "@/lib/arena/funding-source";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  tx_hash: z.string().min(1, { message: "tx_hash is required" }),
});

export async function POST(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  const parsed = await parseOptionalJsonBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await verifyAndSaveFundingSource({
      userId: session.userId,
      txHash: parsed.data.tx_hash,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FundingSourceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("arena.funding_source_failed", {
      user_id: session.userId,
      tx_hash: parsed.data.tx_hash,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to verify funding source" },
      { status: 500 },
    );
  }
}
