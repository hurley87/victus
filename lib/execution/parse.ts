import "server-only";

import {
  normalizeCommandText,
  parseCommand,
  type ParseResult,
} from "@/lib/commodus/parser";

import type { CommandIntent } from "./intents";
import { isTradableCommandSymbol } from "./policy";
import {
  parseCommandIntentWithLlm,
  type ParseWithLlmOptions,
} from "./llm-parse";

/**
 * Two-stage parser for the `parse_command` workflow step.
 *
 * Stage 1 — regex pre-filter (`lib/commodus/parser.ts`).
 *   Canonical buys (`buy N usdc of symbol`) match without an LLM call.
 *   Whitelist validation for the extracted symbol is async against
 *   `asset_whitelist` (#12) so GLORY / unknown tickers get templated
 *   `asset_error` without publishing an intent reply.
 *
 * Stage 2 — Vercel AI SDK fallback (`llm-parse.ts`).
 *   Handles casual phrasings for buy/sell/status that the regex
 *   cannot: `"sell half my aero"`, `"@commodus status"`,
 *   `"what's my rank"`, etc. Returns a `CommandIntent` or signals
 *   `grammar` after retry-once.
 *
 * The result is a narrow `{ ok: true, intent } | { ok: false, reason }`
 * shape. Callers (the workflow) switch on `reason` for templated
 * outcome replies.
 */

export type ParseReason = "grammar_error" | "asset_error";

export type ParseCommandOutcome =
  | { ok: true; intent: CommandIntent }
  | { ok: false; reason: ParseReason; raw?: ParseResult };

export type ParseCommandOptions = {
  /** Passthrough for the LLM fallback (injected in tests). */
  llm?: ParseWithLlmOptions;
};

export async function parseCommandIntent(
  text: string,
  opts: ParseCommandOptions = {},
): Promise<ParseCommandOutcome> {
  const regex = parseCommand(text);

  if (regex.kind === "ok") {
    if (!(await isTradableCommandSymbol(regex.symbol))) {
      return { ok: false, reason: "asset_error", raw: regex };
    }
    return {
      ok: true,
      intent: {
        action: "buy",
        symbol: regex.symbol,
        amount_type: "usdc_in",
        amount_value: regex.amount,
      },
    };
  }

  const normalized = normalizeCommandText(text);
  const llm = await parseCommandIntentWithLlm(normalized, opts.llm);
  if (llm.ok) {
    if (llm.intent.action === "buy" || llm.intent.action === "sell") {
      if (!(await isTradableCommandSymbol(llm.intent.symbol))) {
        return { ok: false, reason: "asset_error", raw: regex };
      }
    }
    return { ok: true, intent: llm.intent };
  }

  return { ok: false, reason: "grammar_error", raw: regex };
}
