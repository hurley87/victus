/**
 * Pure, unit-testable parser for `@commodus` trade commands.
 *
 * Scope (issue #6, "tracer" slice):
 *  - One action: `buy`
 *  - One asset: AERO (hardcoded; full whitelist lookup arrives in #9/#12)
 *  - One amount type: USDC-in
 *  - One size cap: ≤ 10 USDC (hardcoded; per-wallet policy arrives in #12)
 *
 * Anything outside those constraints resolves to a discriminated rejection
 * so the workflow can branch on a single switch. The DB-backed arena-wallet
 * check is intentionally not performed here — it needs a round-trip and
 * must stay out of the pure parser so it remains trivially testable.
 */

/** Hardcoded for this slice. Full whitelist lookup lands in #9/#12. */
export const ALLOWED_SYMBOL = "AERO" as const;

/** Hardcoded for this slice. Per-wallet `wallet_policies` lookup lands in #12. */
export const MAX_USDC_AMOUNT = 10;

export type ParseResult =
  | {
      kind: "ok";
      action: "buy";
      symbol: typeof ALLOWED_SYMBOL;
      amount: number;
    }
  | { kind: "grammar_error" }
  | { kind: "asset_error"; action: "buy"; attemptedSymbol: string; amount: number }
  | {
      kind: "oversize_error";
      action: "buy";
      symbol: typeof ALLOWED_SYMBOL;
      amount: number;
    };

/**
 * Matches a normalized command of the form `buy AMOUNT usdc of SYMBOL`.
 *
 * AMOUNT is a positive decimal with at least one integer digit (leading
 * `.` like `.5` is rejected as grammar — forces users to write `0.5`, which
 * then also fails the positive-decimal check). SYMBOL is any token matching
 * the conventional ticker shape; asset-whitelist filtering happens after
 * the regex matches so we can distinguish "you typed gibberish" from "you
 * typed a symbol we don't trade yet".
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
 *  1. Lowercase (grammar is case-insensitive per AC).
 *  2. Strip any `@handle` mention token so the regex can anchor on `buy`.
 *  3. Collapse Unicode whitespace (tabs, NBSP, doubled spaces, newlines).
 *  4. Trim.
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
 * Rejection priority is structural → asset → size:
 *  1. Unmatched grammar → `grammar_error`.
 *  2. Matched grammar with non-AERO symbol → `asset_error` (we know what
 *     the user wanted; it's just not tradable in this arena yet).
 *  3. Matched grammar with AERO but amount > cap → `oversize_error`.
 *
 * A matched-but-zero-or-negative amount is impossible given the regex
 * (`-` is not allowed, and `0` with no decimal is technically a match of
 * `0`) — so we still guard explicitly by requiring amount > 0 after
 * numeric parsing. That turns `buy 0 usdc of aero` and `buy 0.0 ...` into
 * grammar errors, which is the intended "positive decimal" semantic.
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

  if (symbol !== ALLOWED_SYMBOL) {
    return {
      kind: "asset_error",
      action: "buy",
      attemptedSymbol: symbol,
      amount,
    };
  }

  if (amount > MAX_USDC_AMOUNT) {
    return {
      kind: "oversize_error",
      action: "buy",
      symbol: ALLOWED_SYMBOL,
      amount,
    };
  }

  return {
    kind: "ok",
    action: "buy",
    symbol: ALLOWED_SYMBOL,
    amount,
  };
}
