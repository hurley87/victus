import { z } from "zod";

/**
 * Canonical shapes of a parsed Commodus command.
 *
 * The schemas are the contract between the parser (regex pre-filter +
 * Vercel AI SDK `generateText` + `Output.object` fallback, see
 * `lib/execution/parse.ts`) and the rest of the pipeline. Every
 * downstream consumer (policy checks, fee computation, 0x quote, Privy
 * submission) imports the inferred types.
 *
 * The grammar covers three PRD command shapes (see § Trade Commands):
 *
 *   1. `buy N usdc of SYMBOL`     — action=buy,    amount_type=usdc_in,
 *                                    amount_value ∈ (0, ∞).
 *   2. `sell N% of SYMBOL`        — action=sell,   amount_type=percent_out,
 *                                    amount_value ∈ {1, 2, …, 100}.
 *   3. `status`                   — action=status  (no other fields).
 *
 * The discriminated-union shape pins the cross-field constraints per
 * arm (a buy can never be sized by percent; a sell can never be sized
 * in USDC). `TradeIntentSchema` is the buy+sell subset so the
 * execution pipeline's existing callers keep working.
 */

const SymbolSchema = z
  .string()
  .min(1)
  .regex(/^[A-Z][A-Z0-9]*$/u, "symbol must be an uppercase ticker");

export const BuyIntentSchema = z.object({
  action: z.literal("buy"),
  symbol: SymbolSchema,
  amount_type: z.literal("usdc_in"),
  amount_value: z.number().finite().positive("amount must be positive"),
});

export const SellIntentSchema = z.object({
  action: z.literal("sell"),
  symbol: SymbolSchema,
  amount_type: z.literal("percent_out"),
  /**
   * Integer percent in [1, 100]. `0` is meaningless (sells nothing);
   * values over 100 are impossible (you can't retire more than the
   * position you hold). The narrow constraint makes the schema the
   * single source of truth — policy_validate doesn't need to re-check.
   */
  amount_value: z.number().int().min(1).max(100),
});

export const StatusIntentSchema = z.object({
  action: z.literal("status"),
});

/**
 * Trade-only union. The execution pipeline (`policy_validate`,
 * `compute_fee`, `quote_swap`, `submit_swap`, …) consumes this type
 * because status has no trade to execute.
 */
export const TradeIntentSchema = z.discriminatedUnion("action", [
  BuyIntentSchema,
  SellIntentSchema,
]);

/**
 * Full command union, used at the parser/workflow boundary. The
 * workflow branches on `intent.action === "status"` before entering
 * the trade pipeline.
 */
export const CommandIntentSchema = z.discriminatedUnion("action", [
  BuyIntentSchema,
  SellIntentSchema,
  StatusIntentSchema,
]);

export type BuyIntent = z.infer<typeof BuyIntentSchema>;
export type SellIntent = z.infer<typeof SellIntentSchema>;
export type StatusIntent = z.infer<typeof StatusIntentSchema>;
export type TradeIntent = z.infer<typeof TradeIntentSchema>;
export type CommandIntent = z.infer<typeof CommandIntentSchema>;

/**
 * Type guard for the USDC-in buy arm. The discriminant is `action`,
 * so `"buy"` uniquely implies `amount_type === "usdc_in"` via the
 * schema.
 */
export function isUsdcInIntent(intent: TradeIntent): intent is BuyIntent {
  return intent.action === "buy";
}

/**
 * Type guard that narrows a full `CommandIntent` to the trade-only
 * subset. Callers in the execution pipeline use this to branch off
 * the status arm before invoking policy/fee/quote logic.
 */
export function isTradeIntent(intent: CommandIntent): intent is TradeIntent {
  return intent.action === "buy" || intent.action === "sell";
}
