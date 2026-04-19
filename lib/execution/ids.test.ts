import { describe, expect, it } from "vitest";

import { deriveExecutionId } from "./ids";

describe("deriveExecutionId", () => {
  it("is deterministic for the same cast hash", () => {
    const a = deriveExecutionId("0xdeadbeef");
    const b = deriveExecutionId("0xdeadbeef");
    expect(a).toBe(b);
  });

  it("differs between distinct cast hashes", () => {
    const a = deriveExecutionId("0xdeadbeef");
    const b = deriveExecutionId("0xdeadbeef1");
    expect(a).not.toBe(b);
  });

  it("is 32 lowercase hex characters", () => {
    const id = deriveExecutionId("0xabc123");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("throws on empty input", () => {
    expect(() => deriveExecutionId("")).toThrow();
  });

  it("throws on non-string input", () => {
    // Intentional: we want runtime protection against a bad payload
    // making it past TypeScript (e.g. a JSON.parse round trip).
    expect(() => deriveExecutionId(undefined as unknown as string)).toThrow();
  });
});
