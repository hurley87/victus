import type { ParseResult } from "./parser";

/**
 * Error reasons recorded on `cast_commands.error_reason` for this slice.
 *
 * The column is a free-form `text` in Postgres, so this union is the
 * single source of truth in the app layer. Keep it exhaustive — the
 * workflow switch relies on it.
 */
export type RejectionReason =
  | "grammar"
  | "no_arena_wallet"
  | "non_whitelisted_token"
  | "oversize";

/**
 * Templated rejection copy. Intentionally in-voice and short; Farcaster
 * caps at 320 graphemes and Commodus casts should feel terse, not chatty.
 */
export const REJECTION_REPLIES: Record<RejectionReason, string> = {
  grammar:
    "Speak as Rome taught you, gladiator. Valid decrees: `buy N usdc of SYMBOL`, `sell N% of SYMBOL`, `status`.",
  no_arena_wallet:
    "Enter the arena first, gladiator. Open the Mini App to designate thine arena address.",
  non_whitelisted_token: "Order denied. Asset not approved for this arena.",
  oversize: "Order denied. The decree exceeds thy allotted size.",
};

/**
 * Templated accepted reply. Kept as a function so the amount interpolation
 * has a single definition — tests can pin the exact copy string.
 *
 * `Number#toString` already drops trailing zeros (`10.0 → "10"`,
 * `2.5 → "2.5"`), so we intentionally avoid locale-aware formatting to
 * keep the output stable across runtimes.
 */
export function buildAcceptedReply(amount: number): string {
  return `Order accepted. ${amount.toString()} USDC deployed into AERO.`;
}

/**
 * Pick the rejection reason for a non-ok {@link ParseResult}. Typed so
 * exhaustiveness is checked at compile time.
 */
export function rejectionReasonForParse(
  result: Exclude<ParseResult, { kind: "ok" }>,
): RejectionReason {
  switch (result.kind) {
    case "grammar_error":
      return "grammar";
    case "asset_error":
      return "non_whitelisted_token";
    case "oversize_error":
      return "oversize";
  }
}
