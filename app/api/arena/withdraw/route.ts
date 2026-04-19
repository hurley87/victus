import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseOptionalJsonBody } from "@/lib/arena/http";
import { requireSession } from "@/lib/arena/session";
import type { WithdrawRequest, WithdrawResponse } from "@/lib/arena/types";
import { WithdrawError, withdrawUsdc } from "@/lib/arena/withdraw";

export const dynamic = "force-dynamic";

/**
 * `amount_usdc` is optional; omitted = full sweep. Max 6 decimals
 * (USDC). Upper bound is enforced by the wallet_cap_usdc policy on
 * the way in ($50), but we don't hardcode that here — the service's
 * balance check is authoritative.
 */
const bodySchema = z
  .object({
    amount_usdc: z
      .number()
      .positive({ message: "amount_usdc must be positive" })
      .max(1_000_000, { message: "amount_usdc out of range" })
      .refine(
        (n) => Number.isFinite(n) && Math.round(n * 1e6) === n * 1e6,
        { message: "amount_usdc exceeds USDC's 6-decimal precision" },
      )
      .optional(),
  })
  .optional() satisfies z.ZodType<WithdrawRequest | undefined>;

export async function POST(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  const parsed = await parseOptionalJsonBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await withdrawUsdc({
      userId: session.userId,
      fid: session.fid,
      amountUsdc: parsed.data?.amount_usdc,
    });

    const body: WithdrawResponse = {
      tx_hash: result.tx_hash,
      amount_usdc: result.amount_usdc,
      to: result.to,
      destination_source: result.destination_source,
    };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof WithdrawError) {
      // Log 5xx only — 4xx are user-caused and already observable
      // via access logs.
      if (err.status >= 500) console.error(err.name, err);
      return NextResponse.json(
        { error: err.message, ...(err.extras ?? {}) },
        { status: err.status },
      );
    }
    console.error("Unexpected withdraw error", err);
    return NextResponse.json(
      { error: "Unexpected withdraw error" },
      { status: 500 },
    );
  }
}
