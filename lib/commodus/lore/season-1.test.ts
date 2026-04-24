import { describe, expect, it } from "vitest";

import { MAX_LORE_POST_CHARS, SEASON_1_LORE_POSTS } from "./season-1";

describe("SEASON_1_LORE_POSTS", () => {
  it("contains exactly 30 posts", () => {
    expect(SEASON_1_LORE_POSTS).toHaveLength(30);
  });

  it("uses unique contiguous days from 1 through 30", () => {
    const days = SEASON_1_LORE_POSTS.map((post) => post.day).sort(
      (a, b) => a - b,
    );

    expect(days).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
  });

  it("keeps every post within Farcaster-safe length", () => {
    for (const post of SEASON_1_LORE_POSTS) {
      expect(post.text.length).toBeLessThanOrEqual(MAX_LORE_POST_CHARS);
    }
  });
});
