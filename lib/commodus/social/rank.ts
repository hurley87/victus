import type { SocialCastEvent } from "@/lib/workflows/commodus-social";

export type SocialAction = "reply" | "ignore" | "save_only" | "error";
export type SocialRelationship = "ally" | "rival" | "unknown" | "muted";

export interface SocialRankDecision {
  action: SocialAction;
  score: number;
  reason: string;
  riskFlags: string[];
}

export interface SocialRankInput {
  cast: Pick<SocialCastEvent, "text">;
  trigger: "reply_to_commodus" | "mention";
  relationship?: SocialRelationship | null;
  lastCommodusReplyAt?: Date | string | null;
  now?: Date;
}

const MIN_REPLY_SCORE = 50;
const RECENT_REPLY_WINDOW_MS = 15 * 60 * 1000;

const TRAGEDY_OR_HARASSMENT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(died|dead|death|killed|murder|fatal|funeral|rip)\b/i, "tragedy"],
  [/\b(war|bombing|shooting|mass casualty|terror attack)\b/i, "tragedy"],
  [/\b(suicide|self[-\s]?harm|overdose)\b/i, "health_crisis"],
  [/\b(cancer|hospital|surgery|miscarriage|eviction|abuse)\b/i, "personal_crisis"],
  [/\b(dogpile|pile[-\s]?on|everyone report|mass report|brigade)\b/i, "harassment"],
];

const BARE_EMOJI_OR_PUNCTUATION = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s!?.,'"`~:;()\-]+$/u;

export function rankSocialCast(input: SocialRankInput): SocialRankDecision {
  const text = input.cast.text.trim();
  const relationship = input.relationship ?? "unknown";

  if (relationship === "muted") {
    return ignore("muted_author", 0, ["muted_author"]);
  }

  for (const [pattern, flag] of TRAGEDY_OR_HARASSMENT_PATTERNS) {
    if (pattern.test(text)) {
      return ignore(flag, 0, [flag]);
    }
  }

  if (isLowContext(text)) {
    return {
      action: "save_only",
      score: 8,
      reason: "low_context",
      riskFlags: ["low_context"],
    };
  }

  if (isRecentlyReplied(input.lastCommodusReplyAt, input.now ?? new Date())) {
    return {
      action: "save_only",
      score: 20,
      reason: "recent_reply",
      riskFlags: ["recent_reply"],
    };
  }

  let score = input.trigger === "mention" ? 58 : 52;
  if (relationship === "rival") score += 12;
  if (relationship === "ally") score += 6;
  if (text.length >= 40) score += 8;
  if (/[?$]/.test(text)) score += 6;
  if (/\b(commodus|victus|rank|trade|arena|score|portfolio)\b/i.test(text)) score += 8;

  const shouldReply = score >= MIN_REPLY_SCORE;
  return {
    action: shouldReply ? "reply" : "save_only",
    score,
    reason: shouldReply ? "ranked_reply" : "weak_signal",
    riskFlags: [],
  };
}

function ignore(reason: string, score: number, riskFlags: string[]): SocialRankDecision {
  return { action: "ignore", score, reason, riskFlags };
}

function isLowContext(text: string): boolean {
  if (!text) return true;
  if (text.length <= 2) return true;
  return text.length <= 12 && BARE_EMOJI_OR_PUNCTUATION.test(text);
}

function isRecentlyReplied(value: Date | string | null | undefined, now: Date): boolean {
  if (!value) return false;
  const repliedAt = value instanceof Date ? value : new Date(value);
  const timestamp = repliedAt.getTime();
  if (!Number.isFinite(timestamp)) return false;
  return now.getTime() - timestamp < RECENT_REPLY_WINDOW_MS;
}
