import type { ParseResult } from "./parser";

export type {
  ParserRejectionReason as RejectionReason,
} from "@/lib/commodus-voice";
export {
  REJECTION_REPLIES,
  buildAcceptedReply,
} from "@/lib/commodus-voice";

/**
 * Pick the rejection reason for a non-ok {@link ParseResult}. Typed so
 * exhaustiveness is checked at compile time.
 */
export function rejectionReasonForParse(
  result: Exclude<ParseResult, { kind: "ok" }>,
): import("@/lib/commodus-voice").ParserRejectionReason {
  switch (result.kind) {
    case "grammar_error":
      return "grammar";
  }
}
