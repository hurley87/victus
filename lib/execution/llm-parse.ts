import "server-only";

import { Output, generateText } from "ai";
import { z } from "zod";

import {
  BuyIntentSchema,
  CommandIntentSchema,
  SellIntentSchema,
  StatusIntentSchema,
  type CommandIntent,
} from "./intents";

/**
 * Vercel AI SDK fallback for the Commodus command parser.
 *
 * Invoked only when the regex pre-filter in `lib/commodus/parser.ts`
 * fails with `grammar_error`. Scope is deliberately narrow:
 *
 *  1. Map casual phrasings the regex can't handle (`"sell half my aero"`)
 *     to the canonical `CommandIntent` shape.
 *  2. Emit `status` intents for the no-argument status command.
 *  3. Signal "not a command" when the cast text is conversational or
 *     otherwise unparsable — we add a fourth arm (`{ action: "invalid" }`)
 *     to the schema the LLM sees so it has a structural way to say "I
 *     can't parse this" rather than inventing a trade.
 *
 * Asset-whitelist and size enforcement stay in `policy_validate`. The
 * LLM is explicitly instructed not to introduce symbols or amounts
 * that aren't present in the user text.
 *
 * Retry semantics: one retry (total two attempts) on any failure
 * (gateway error, schema validation error, or explicit `invalid`
 * result). A second failure returns `{ ok: false, reason: "grammar" }`
 * so the workflow publishes the templated grammar rejection once and
 * marks `cast_commands.error_reason='grammar'`.
 *
 * Routing: defaults to `openai/gpt-5.4-mini` via the Vercel AI Gateway
 * (global default provider when importing `model: "openai/..."` from
 * `ai`). Model selection is a string to avoid hardcoding a provider
 * SDK import — the gateway handles routing, failover, and auth.
 */

/**
 * Model identifier sent to the Vercel AI Gateway. `openai/gpt-5.4-mini`
 * is the cheapest OpenAI model with reliable JSON-schema adherence as
 * of the issue-9 ship date. Override via `opts.model` for tests or
 * provider experiments.
 */
export const DEFAULT_COMMAND_PARSER_MODEL = "openai/gpt-5.4-mini";

/**
 * Schema sent to the LLM. Includes an `invalid` arm so the model can
 * surface "no command present" without having to throw. The outer
 * helper collapses `invalid` into `{ ok: false, reason: "grammar" }`.
 */
const InvalidIntentSchema = z.object({
  action: z.literal("invalid"),
});

const LlmCommandIntentSchema = z.discriminatedUnion("action", [
  BuyIntentSchema,
  SellIntentSchema,
  StatusIntentSchema,
  InvalidIntentSchema,
]);

export type LlmCommandIntent = z.infer<typeof LlmCommandIntentSchema>;

export type LlmParseResult =
  | { ok: true; intent: CommandIntent }
  | { ok: false; reason: "grammar" };

const SYSTEM_PROMPT = `You are the grammar validator for the Commodus Roman-arena trading bot.

Your only job is to classify a single cast text into exactly one of four shapes:

  1. buy:    { "action": "buy",    "symbol": "<TICKER>",   "amount_type": "usdc_in",     "amount_value": <positive number> }
  2. sell:   { "action": "sell",   "symbol": "<TICKER>",   "amount_type": "percent_out", "amount_value": <integer 1..100> }
  3. status: { "action": "status" }
  4. invalid:{ "action": "invalid" }

Canonical PRD grammar:
  - "buy N usdc of SYMBOL"       e.g. "buy 5 usdc of aero"
  - "sell N% of SYMBOL"          e.g. "sell 50% of aero"
  - "status"

Casual phrasings you must accept (examples — not exhaustive):
  - "buy $10 aero"                        → buy,  symbol=AERO, amount_value=10
  - "@commodus grab 2 usdc worth of aero" → buy,  symbol=AERO, amount_value=2
  - "sell half my aero"                   → sell, symbol=AERO, amount_value=50
  - "sell 25% of my aero"                 → sell, symbol=AERO, amount_value=25
  - "dump all my aero"                    → sell, symbol=AERO, amount_value=100
  - "status"                              → status
  - "@commodus status"                    → status
  - "what's my rank?"                     → status
  - "show my portfolio"                   → status

Normalization rules:
  - Input is already lowercased and trimmed.
  - Strip any leading mention token like "@commodus" or "@commo".
  - Return symbols UPPERCASED, shape /^[A-Z][A-Z0-9]*$/.

Hard rules — violations must resolve to { "action": "invalid" }:
  - Never invent a symbol that is not present in the user text.
  - Never invent an amount that is not present or implied by the user text.
    ("half" → 50, "all" → 100, "a quarter" → 25 are allowed inferences.)
  - Never return a buy without a USDC amount.
  - Never return a sell without a percent (or an implied percent from half/all/etc.).
  - Never produce a command from casts that contain no trade/status verb
    ("hello commodus", "gm", "lol" → invalid).
  - Never return amount_type: "usdc_in" for sells, or "percent_out" for buys.

You must not output anything outside the schema. No free-form text.`;

export type ParseWithLlmOptions = {
  /** AI Gateway model identifier. */
  model?: string;
  /**
   * Maximum number of retries after the first failure. Defaults to 1
   * (AC § retry-once-then-hard-fail). Set to 0 in tests that want to
   * pin single-attempt behavior.
   */
  maxRetries?: number;
  /**
   * Injected for tests. Defaults to `generateText` from `ai`. The
   * function-typed seam lets the test suite mock without `vi.mock`.
   */
  generate?: typeof generateText;
};

export async function parseCommandIntentWithLlm(
  text: string,
  opts: ParseWithLlmOptions = {},
): Promise<LlmParseResult> {
  const model = opts.model ?? DEFAULT_COMMAND_PARSER_MODEL;
  const maxRetries = opts.maxRetries ?? 1;
  const generate = opts.generate ?? generateText;
  const totalAttempts = 1 + Math.max(0, maxRetries);

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const result = await generate({
        model,
        output: Output.object({ schema: LlmCommandIntentSchema }),
        system: SYSTEM_PROMPT,
        prompt: `Cast text (already lowercased + mention-stripped): ${JSON.stringify(text)}`,
      });

      // `result.output` is typed by `Output.object`, but the SDK does
      // not validate against our schema end-to-end — we re-validate so
      // a provider that silently drops fields lands in the retry loop.
      const parsed = LlmCommandIntentSchema.safeParse(result.output);
      if (!parsed.success) continue;
      if (parsed.data.action === "invalid") continue;

      return { ok: true, intent: parsed.data };
    } catch {
      // Swallow — any gateway or schema error burns one attempt and
      // falls through to the retry or hard-fail below.
    }
  }

  return { ok: false, reason: "grammar" };
}
