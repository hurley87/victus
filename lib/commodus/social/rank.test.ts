import { describe, expect, it } from "vitest";

import { rankSocialCast } from "./rank";

describe("rankSocialCast", () => {
  it("ranks a substantive direct mention as a reply candidate", () => {
    expect(
      rankSocialCast({
        cast: { text: "@commodus what's my arena score look like?" },
        trigger: "mention",
        relationship: "rival",
      }),
    ).toMatchObject({ action: "reply", reason: "ranked_reply" });
  });

  it("ignores tragedy and harassment keywords before any generation step", () => {
    expect(
      rankSocialCast({
        cast: { text: "@commodus my friend died yesterday" },
        trigger: "mention",
      }),
    ).toMatchObject({ action: "ignore", reason: "tragedy", riskFlags: ["tragedy"] });

    expect(
      rankSocialCast({
        cast: { text: "everyone pile on this guy" },
        trigger: "reply_to_commodus",
      }),
    ).toMatchObject({ action: "ignore", reason: "harassment" });
  });

  it("saves low-context replies without promoting them to reply", () => {
    expect(
      rankSocialCast({
        cast: { text: "🔥🔥" },
        trigger: "reply_to_commodus",
      }),
    ).toMatchObject({ action: "save_only", reason: "low_context" });
  });

  it("saves recent repeat interactions instead of replying again immediately", () => {
    expect(
      rankSocialCast({
        cast: { text: "@commodus you already answered but say more about my rank" },
        trigger: "mention",
        lastCommodusReplyAt: "2026-04-26T12:00:00.000Z",
        now: new Date("2026-04-26T12:10:00.000Z"),
      }),
    ).toMatchObject({ action: "save_only", reason: "recent_reply" });
  });
});
