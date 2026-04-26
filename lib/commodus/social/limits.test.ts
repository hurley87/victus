import { describe, expect, it } from "vitest";

import {
  MAX_AUTHOR_REPLIES_24H,
  MAX_THREAD_REPLIES,
  evaluateSocialLimits,
} from "./limits";

describe("evaluateSocialLimits", () => {
  const base = {
    blocklisted: false,
    threadMuted: false,
    threadReplyCount: 0,
    authorReplyCount24h: 0,
  };

  it("always ignores blocklisted FIDs", () => {
    expect(evaluateSocialLimits({ ...base, blocklisted: true })).toEqual({
      allowed: false,
      reason: "blocklist",
      riskFlags: ["blocklist"],
    });
  });

  it("enforces the per-thread cap excluding the originating cast", () => {
    expect(
      evaluateSocialLimits({
        ...base,
        threadReplyCount: MAX_THREAD_REPLIES - 1,
      }),
    ).toEqual({ allowed: true });

    expect(
      evaluateSocialLimits({
        ...base,
        threadReplyCount: MAX_THREAD_REPLIES,
      }),
    ).toMatchObject({ allowed: false, reason: "thread_cap" });
  });

  it("enforces the rolling 24h per-author cap without reset semantics", () => {
    expect(
      evaluateSocialLimits({
        ...base,
        authorReplyCount24h: MAX_AUTHOR_REPLIES_24H - 1,
      }),
    ).toEqual({ allowed: true });

    expect(
      evaluateSocialLimits({
        ...base,
        authorReplyCount24h: MAX_AUTHOR_REPLIES_24H,
      }),
    ).toMatchObject({ allowed: false, reason: "author_cap" });
  });
});
