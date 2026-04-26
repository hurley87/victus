import { normalizeCommandText, parseCommand } from "@/lib/commodus/parser";

export type CastRoute = "trade" | "social";

/**
 * Verbs and phrasings that indicate the user is *attempting* a trade
 * or status command — even if the regex pre-filter doesn't match.
 * Matches the casual-phrasing surface area the LLM fallback in
 * `lib/execution/llm-parse.ts` handles (`buy/sell/dump/grab/status/
 * portfolio/rank`). Anything else is conversational and routes to the
 * social agent.
 *
 * Word-boundary anchored to avoid matching e.g. "buyback" → "buy" or
 * "estatus" → "status". Lowercased text is the input contract.
 */
const TRADE_INTENT_PATTERNS: RegExp[] = [
  /\bbuy\b/u,
  /\bsell\b/u,
  /\bdump\b/u,
  /\bgrab\s+\d/u,
  /\bstatus\b/u,
  /\bportfolio\b/u,
  /\brank\b/u,
  /\$[a-z][a-z0-9]*\b.*\b(buy|sell|dump)\b/u,
];

/**
 * Pure router used by the Neynar webhook to fire exactly one workflow
 * per inbound cast. Trade workflow handles parse → execute → reply;
 * social workflow handles conversational replies and mentions. Routing
 * here prevents both workflows from running on the same cast.
 *
 * Heuristic — must be sync (LLM not allowed in webhook hot path):
 *   1. Canonical regex (`buy N usdc of SYMBOL`) → trade
 *   2. Any trade-intent keyword present → trade (LLM will refine)
 *   3. Otherwise → social
 */
export function routeCast(text: string): CastRoute {
  const regex = parseCommand(text);
  if (regex.kind === "ok") return "trade";

  const normalized = normalizeCommandText(text);
  if (TRADE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "trade";
  }

  return "social";
}
