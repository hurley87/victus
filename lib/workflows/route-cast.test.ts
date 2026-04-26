import { describe, expect, it } from "vitest";

import { routeCast } from "./route-cast";

describe("routeCast", () => {
  it.each([
    ["buy 5 usdc of aero", "canonical regex"],
    ["@commodus buy 1 usdc of virtual", "regex with mention"],
    ["sell 50% of aero", "sell phrasing"],
    ["dump all my aero", "dump verb"],
    ["status", "status verb"],
    ["@commodus what's my rank?", "rank keyword"],
    ["show my portfolio", "portfolio keyword"],
    ["grab 2 usdc worth of aero", "grab N pattern"],
  ])("routes %j to trade (%s)", (text) => {
    expect(routeCast(text)).toBe("trade");
  });

  it.each([
    ["why you like virtual?", "conversational question"],
    ["gm commodus", "greeting"],
    ["lol nice trade", "reaction"],
    ["@commodus thoughts on aero?", "opinion request — no trade verb"],
    ["caesar approves", "lore reply"],
    ["", "empty"],
  ])("routes %j to social (%s)", (text) => {
    expect(routeCast(text)).toBe("social");
  });
});
