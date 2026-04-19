import "server-only";

import {
  normalizeCommandText,
  parseCommand,
  type ParseResult,
} from "@/lib/commodus/parser";

import type { CommandIntent } from "./intents";
import {
  parseCommandIntentWithLlm,
  type ParseWithLlmOptions,
} from "./llm-parse";

/**
 * Two-stage parser for the `parse_command` workflow step.
 *
 * Stage 1 — regex pre-filter (`lib/commodus/parser.ts`).
 *   The canonical AERO buy path (`buy N usdc of aero`) is matched
 *   without any LLM call and returns a buy `CommandIntent` directly.
 *   Grammar mismatches fall through to Stage 2. Structurally-valid
 *   buys that fail the hardcoded whitelist / size heuristics
 *   (`asset_error`, `oversize_error`) short-circuit here — the
 *   parser is the right layer to surface "you typed a real command
 *   but it's not tradable", and `policy_validate` will redundantly
 *   reject the same cases for LLM-parsed variants.
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

export type ParseReason =
  | "grammar_error"
  | "asset_error"
  | "oversize_error";

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

  if (regex.kind === "asset_error" || regex.kind === "oversize_error") {
    return { ok: false, reason: regex.kind, raw: regex };
  }

  const normalized = normalizeCommandText(text);
  const llm = await parseCommandIntentWithLlm(normalized, opts.llm);
  if (llm.ok) return { ok: true, intent: llm.intent };

  return { ok: false, reason: "grammar_error", raw: regex };
}
