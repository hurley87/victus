import { z } from "zod";

/**
 * Canonical shape of a parsed Commodus trade command.
 *
 * This is the contract between the parser (regex pre-filter + future
 * Vercel AI SDK `generateObject` pass) and the rest of the pipeline.
 * The Zod schema is authoritative — everything downstream (policy
 * checks, fee computation, 0x quote, Privy submission) consumes the
 * inferred type `TradeIntent`.
 *
 * MVP grammar is buy-only (see `lib/commodus/parser.ts` and the brief
 * on #8), but the schema supports sell now so adding the sell branch
 * in a follow-up doesn't churn callers.
 */
export const TradeIntentSchema = z.object({
  action: z.enum(["buy", "sell"]),
  symbol: z
    .string()
    .min(1)
    .regex(/^[A-Z][A-Z0-9]*$/u, "symbol must be an uppercase ticker"),
  /**
   * Buys: USDC-in notional (how many USDC to spend). Sells: USDC-out
   * notional if the command is sized in USDC. Percent-sell commands
   * are represented with `amount_type='percent_out'` — not yet wired
   * through the parser; the schema accepts the shape so the workflow
   * contract is stable.
   */
  amount_type: z.enum(["usdc_in", "percent_out"]).default("usdc_in"),
  amount_value: z
    .number()
    .finite()
    .positive("amount must be positive"),
});

export type TradeIntent = z.infer<typeof TradeIntentSchema>;

/**
 * Type guard for `TradeIntent.amount_type === 'usdc_in'`. Keeps callers
 * that care about the buy-only MVP path from re-asserting the literal
 * at every site.
 */
export function isUsdcInIntent(intent: TradeIntent): intent is TradeIntent & {
  amount_type: "usdc_in";
} {
  return intent.amount_type === "usdc_in";
}
