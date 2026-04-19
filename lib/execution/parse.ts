import "server-only";

import {
  parseCommand,
  type ParseResult,
} from "@/lib/commodus/parser";

import { TradeIntentSchema, type TradeIntent } from "./intents";

/**
 * Parser step entry point for the durable pipeline.
 *
 * Today this is a regex pre-filter only. Future-compat: if the regex
 * does not match, fall through to a Vercel AI SDK `generateObject`
 * call against the AI Gateway with `TradeIntentSchema`. That fallback
 * is intentionally stubbed for now — the tradeoff is observability:
 * the regex handles 95% of canonical `buy N usdc of SYMBOL` phrasing,
 * and falling back for the 5% of casual grammar costs latency + AI
 * spend that we'd rather not pay before the pipeline is seasoned.
 *
 * The parse result is normalized to one of two shapes the workflow
 * can switch on:
 *
 *   - `{ ok: true, intent }` — a validated `TradeIntent` (Zod-parsed,
 *     ready for policy + fee + quote steps).
 *   - `{ ok: false, reason }` — a rejection reason matching the
 *     `lib/commodus/templates` catalog so outcome-reply wiring is
 *     deterministic.
 */

export type ParseReason =
  | "grammar_error"
  | "asset_error"
  | "oversize_error";

export type ParseOutcome =
  | { ok: true; intent: TradeIntent }
  | { ok: false; reason: ParseReason; raw: ParseResult };

export function parseTradeCommand(text: string): ParseOutcome {
  const result = parseCommand(text);

  if (result.kind === "ok") {
    const intent = TradeIntentSchema.parse({
      action: result.action,
      symbol: result.symbol,
      amount_type: "usdc_in",
      amount_value: result.amount,
    });
    return { ok: true, intent };
  }

  return { ok: false, reason: result.kind, raw: result };
}
