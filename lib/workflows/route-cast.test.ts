import { describe, expect, it } from "vitest";

import { routeCast } from "./route-cast";

describe("routeCast", () => {
  it.each([
    ["buy 5 usdc of aero", "trade"],
    ["@commodus buy 1 usdc of virtual", "trade"],
    ["sell 50% of aero", "trade"],
    ["dump all my aero", "trade"],
    ["status", "trade"],
    ["@commodus what's my rank?", "trade"],
    ["show my portfolio", "trade"],
    ["grab 2 usdc worth of aero", "trade"],
    ["why you like virtual?", "social"],
    ["gm commodus", "social"],
    ["lol nice trade", "social"],
    ["@commodus thoughts on aero?", "social"],
    ["caesar approves", "social"],
    ["", "social"],
  ] as const)("routes %j to %s", (text, expected) => {
    expect(routeCast(text)).toBe(expected);
  });
});
