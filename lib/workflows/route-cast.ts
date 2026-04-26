import { normalizeCommandText, parseCommand } from "@/lib/commodus/parser";

export type CastRoute = "trade" | "social";

/** Trade/status intent surface aligned with `llm-parse` casual phrasing; word-boundary + lowercase input. */
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

/** Sync webhook router: canonical parse → trade; else trade-intent keywords → trade; else social (one workflow per cast). */
export function routeCast(text: string): CastRoute {
  const regex = parseCommand(text);
  if (regex.kind === "ok") return "trade";

  const normalized = normalizeCommandText(text);
  if (TRADE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "trade";
  }

  return "social";
}
