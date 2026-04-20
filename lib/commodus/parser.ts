/**
 * Pure, unit-testable parser for `@commodus` trade commands.
 *
 * Stage-1 regex matches canonical `buy AMOUNT usdc of SYMBOL` commands.
 * Symbol whitelist and `max_trade_usdc` enforcement run in async
 * `parseCommandIntent` / `policy_validate` (#12) so policy DB values are
 * the single source of truth for caps.
 */

/** Default `max_trade_usdc` (policy is authoritative); kept for tests. */
export const MAX_USDC_AMOUNT = 10;

export type ParseResult =
  | {
      kind: "ok";
      action: "buy";
      symbol: string;
      amount: number;
    }
  | { kind: "grammar_error" };

/**
 * Matches a normalized command of the form `buy AMOUNT usdc of SYMBOL`.
 *
 * SYMBOL is any conventional ticker; whitelist filtering is async in
 * `parseCommandIntent` so users get `asset_error` with templated copy
 * rather than a grammar miss.
 */
const COMMAND_REGEX =
  /^buy\s+([0-9]+(?:\.[0-9]+)?)\s+usdc\s+of\s+([a-z][a-z0-9]*)\s*$/u;

/**
 * Strip any `@handle` mention token. We are intentionally handle-agnostic:
 * the bot's Farcaster handle has changed before (`@commodus` → `@commo`)
 * and Neynar's subscription filter already guarantees the cast mentions
 * the bot before the webhook fires, so we can afford to strip any leading
 * or embedded `@handle` without risking false matches.
 *
 * Handles on Farcaster are `[a-z0-9_-]` and have no dots, so this won't
 * eat the domain of an email-shaped token (`user@example.com` → `user.com`
 * is a theoretical edge case nobody would trigger through a trade command).
 */
const MENTION_REGEX = /@[a-z0-9_-]+/giu;

/**
 * Normalize a raw cast text into a canonical command string.
 *
 * Steps, in order:
 *   1. Lowercase (grammar is case-insensitive per AC).
 *   2. Strip any `@handle` mention token so the regex can anchor on `buy`.
 *   3. Collapse Unicode whitespace (tabs, NBSP, doubled spaces, newlines).
 *   4. Trim.
 *
 * Done as a separate export so tests can exercise the normalization step
 * directly without going through the discriminated-union result shape.
 */
export function normalizeCommandText(text: string): string {
  return text
    .toLowerCase()
    .replace(MENTION_REGEX, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Parse a raw `@commodus` cast text into a {@link ParseResult}.
 *
 * Unmatched grammar → `grammar_error`. Matched buys return `ok` with an
 * uppercased symbol; oversize and whitelist failures are handled later
 * in the durable pipeline.
 */
export function parseCommand(text: string): ParseResult {
  const normalized = normalizeCommandText(text);
  const match = normalized.match(COMMAND_REGEX);

  if (!match) {
    return { kind: "grammar_error" };
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { kind: "grammar_error" };
  }

  const symbol = match[2].toUpperCase();

  return {
    kind: "ok",
    action: "buy",
    symbol,
    amount,
  };
}
