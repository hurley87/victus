import "server-only";

import { z } from "zod";

import { env } from "@/lib/env";

/**
 * Minimal 0x Swap API v2 (Allowance Holder) client.
 *
 * We use the Allowance Holder flow so the arena wallet approves a
 * single canonical contract (0x's AllowanceHolder) for MAX_UINT once
 * per token, then every subsequent swap is a single `eth_sendTransaction`
 * to that same contract. No per-swap approval dance — relevant given
 * every tx is gas-sponsored and we want to minimize the sponsored
 * surface area.
 *
 * Docs: https://0x.org/docs/api#tag/Swap/operation/swap::allowanceHolder::getQuote
 *
 * What this module covers:
 *   - `getAllowanceHolderQuote(params)` — GET /swap/allowance-holder/quote
 *     with Zod-validated response. Throws structured errors so the
 *     workflow step can branch on them cleanly.
 *
 * What it intentionally does NOT cover:
 *   - Approval bookkeeping (callers should track per-wallet allowance
 *     state separately; for MVP we set max approval at mint time).
 *   - Price vs quote distinction (we only need quote+calldata).
 *   - Sell-side sizing (MVP is buy-only; sells add post-MVP).
 */

const ZEROX_API_BASE = "https://api.0x.org";
const ZEROX_API_VERSION = "v2";

/** Base mainnet chain ID, 0x-compatible. */
const BASE_CHAIN_ID = 8453 as const;

export class ZeroxNotConfiguredError extends Error {
  constructor() {
    super("ZEROX_API_KEY is not configured");
    this.name = "ZeroxNotConfiguredError";
  }
}

export class ZeroxApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`0x API error ${status}: ${body.slice(0, 300)}`);
    this.name = "ZeroxApiError";
  }
}

// ---------------------------------------------------------------------------
// Response schema (narrow; we only consume what the pipeline needs)
// ---------------------------------------------------------------------------

const hexString = z.string().regex(/^0x[0-9a-fA-F]+$/, "must be 0x-prefixed hex");
const decimalString = z.string().regex(/^[0-9]+$/, "must be base-unit decimal");

/**
 * Transaction object returned by 0x. The fields used downstream are
 * `to` (the AllowanceHolder contract), `data` (calldata), and `value`
 * (zero for ERC-20 → ERC-20 swaps; non-zero for ETH legs). Other
 * fields (gas, gasPrice) are ignored — Privy's sponsor path does its
 * own estimation.
 */
const transactionSchema = z.object({
  to: hexString,
  data: hexString,
  value: decimalString,
  gas: z.string().optional(),
  gasPrice: z.string().optional(),
});

export const allowanceHolderQuoteSchema = z.object({
  blockNumber: z.string().optional(),
  buyAmount: decimalString,
  sellAmount: decimalString,
  /** Contract that needs allowance for `sellToken`. Always the AllowanceHolder v2 address on Base. */
  issues: z
    .object({
      allowance: z
        .object({
          spender: hexString,
          actual: decimalString.optional(),
        })
        .nullable()
        .optional(),
      balance: z
        .object({
          token: hexString,
          actual: decimalString.optional(),
          expected: decimalString.optional(),
        })
        .nullable()
        .optional(),
      simulationIncomplete: z.boolean().optional(),
      invalidSourcesPassed: z.array(z.string()).optional(),
    })
    .optional(),
  transaction: transactionSchema,
  /** Spot price of sellToken in buyToken base units. Used downstream for UI only. */
  price: z.string().optional(),
  /** Execution price after slippage — consumed by the score_time price-impact guard. */
  guaranteedPrice: z.string().optional(),
  /** 0x's reported price impact in percent (not bps). */
  totalNetworkFee: z.string().optional(),
  minBuyAmount: decimalString.optional(),
  liquidityAvailable: z.boolean().default(true),
  zid: z.string().optional(),
});

export type AllowanceHolderQuote = z.infer<typeof allowanceHolderQuoteSchema>;

export type GetAllowanceHolderQuoteParams = {
  /** ERC-20 address of the token the taker is selling. */
  sellToken: string;
  /** ERC-20 address of the token the taker is buying. */
  buyToken: string;
  /** Amount of `sellToken` in base units (string to avoid float precision loss). */
  sellAmount: string;
  /** Address that will execute the swap (the arena wallet). */
  taker: string;
  /**
   * Slippage expressed in basis points. 0x's parameter is `slippageBps`
   * (integer). Defaults to 100 (1%) — matches the per-wallet policy
   * default `max_slippage_bps`.
   */
  slippageBps?: number;
};

/**
 * Fetch a firm quote + calldata from 0x for a `sellAmount`-sized swap
 * on Base. Returns the validated quote; throws `ZeroxApiError` for
 * HTTP errors and `ZeroxNotConfiguredError` if the API key is unset.
 */
export async function getAllowanceHolderQuote(
  params: GetAllowanceHolderQuoteParams,
): Promise<AllowanceHolderQuote> {
  if (!env.ZEROX_API_KEY) {
    throw new ZeroxNotConfiguredError();
  }

  const qs = new URLSearchParams({
    chainId: String(BASE_CHAIN_ID),
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: params.sellAmount,
    taker: params.taker,
    slippageBps: String(params.slippageBps ?? 100),
  });

  const response = await fetch(
    `${ZEROX_API_BASE}/swap/allowance-holder/quote?${qs.toString()}`,
    {
      method: "GET",
      headers: {
        "0x-api-key": env.ZEROX_API_KEY,
        "0x-version": ZEROX_API_VERSION,
        accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ZeroxApiError(response.status, body);
  }

  const json: unknown = await response.json();
  const parsed = allowanceHolderQuoteSchema.safeParse(json);
  if (!parsed.success) {
    throw new ZeroxApiError(
      500,
      `Malformed response: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}
