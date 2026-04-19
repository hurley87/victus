import { describe, expect, it } from "vitest";

import { replyIdempotencyKey } from "./replies";

describe("replyIdempotencyKey", () => {
  it("distinguishes intent and outcome keys for the same cast", () => {
    const castHash = "0xdeadbeef";
    const intent = replyIdempotencyKey(castHash, "intent");
    const outcome = replyIdempotencyKey(castHash, "outcome");
    expect(intent).not.toBe(outcome);
    expect(intent).toContain(castHash);
    expect(outcome).toContain(castHash);
  });

  it("is deterministic across calls", () => {
    const a = replyIdempotencyKey("0xabc", "outcome");
    const b = replyIdempotencyKey("0xabc", "outcome");
    expect(a).toBe(b);
  });
});
