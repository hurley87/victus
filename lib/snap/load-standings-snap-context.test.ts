import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentLeaderboardResult, LeaderboardEntry } from "@/lib/leaderboard/service";
import type { StatusViewContext } from "@/lib/status/load-context";

import { loadStandingsSnapContext } from "./load-standings-snap-context";

function leaderboardEntry(
  partial: Pick<LeaderboardEntry, "rank" | "fid" | "points"> &
    Partial<Omit<LeaderboardEntry, "rank" | "fid" | "points">>,
): LeaderboardEntry {
  return {
    user_id: `user-${partial.fid}`,
    username: null,
    realized_pnl_usdc: 0,
    last_trade_at: null,
    ...partial,
  };
}

const baseStatus: StatusViewContext = {
  fid: 99,
  displayHandle: "Maximus",
  rank: 12,
  points: 40,
  portfolioUsdc: 100,
  dailySlotsRemaining: 3,
  topTenCutoffPoints: 80,
};

vi.mock("@/lib/leaderboard/service", () => ({
  getCurrentMonthLeaderboard: vi.fn(),
}));

vi.mock("@/lib/status/load-context", () => ({
  loadStatusViewContext: vi.fn(),
}));

import { getCurrentMonthLeaderboard } from "@/lib/leaderboard/service";
import { loadStatusViewContext } from "@/lib/status/load-context";

describe("loadStandingsSnapContext", () => {
  beforeEach(() => {
    vi.mocked(loadStatusViewContext).mockResolvedValue({ ...baseStatus });
  });

  it("returns top 5 with the user row marked when the user is in the top 5", async () => {
    const result: CurrentLeaderboardResult = {
      month: "2025-06",
      entries: [
        leaderboardEntry({ rank: 1, fid: 1, points: 100, username: "aurelius" }),
        leaderboardEntry({ rank: 2, fid: 2, points: 90, username: "lucilla" }),
        leaderboardEntry({ rank: 3, fid: 99, points: 85, username: "hero" }),
        leaderboardEntry({ rank: 4, fid: 4, points: 70, username: "d" }),
        leaderboardEntry({ rank: 5, fid: 5, points: 60, username: "e" }),
        leaderboardEntry({ rank: 6, fid: 6, points: 50, username: "f" }),
      ],
    };
    vi.mocked(getCurrentMonthLeaderboard).mockResolvedValue(result);

    const ctx = await loadStandingsSnapContext(99);

    expect(ctx).not.toBeNull();
    expect(ctx?.displayHandle).toBe("Maximus");
    expect(ctx?.entries).toHaveLength(5);
    const onlyUser = ctx?.entries.find((e) => e.isUser);
    expect(onlyUser).toBeDefined();
    expect(onlyUser).toMatchObject({
      rank: 3,
      label: "@hero",
      points: 85,
      isUser: true,
    });
  });

  it("appends the user row when they are not in the top 5 but appear on the leaderboard", async () => {
    const result: CurrentLeaderboardResult = {
      month: "2025-06",
      entries: [
        leaderboardEntry({ rank: 1, fid: 1, points: 100, username: "a" }),
        leaderboardEntry({ rank: 2, fid: 2, points: 90, username: "b" }),
        leaderboardEntry({ rank: 3, fid: 3, points: 80, username: "c" }),
        leaderboardEntry({ rank: 4, fid: 4, points: 70, username: "d" }),
        leaderboardEntry({ rank: 5, fid: 5, points: 60, username: "e" }),
        leaderboardEntry({ rank: 6, fid: 99, points: 45, username: "maximus" }),
      ],
    };
    vi.mocked(getCurrentMonthLeaderboard).mockResolvedValue(result);

    const ctx = await loadStandingsSnapContext(99);

    expect(ctx?.entries).toHaveLength(6);
    const appended = ctx?.entries[5];
    expect(appended).toMatchObject({
      rank: 6,
      label: "@maximus",
      points: 45,
      isUser: true,
    });
  });

  it("falls back to status when the user is not on the leaderboard list", async () => {
    const result: CurrentLeaderboardResult = {
      month: "2025-06",
      entries: [
        leaderboardEntry({ rank: 1, fid: 1, points: 100 }),
        leaderboardEntry({ rank: 2, fid: 2, points: 90 }),
        leaderboardEntry({ rank: 3, fid: 3, points: 80 }),
        leaderboardEntry({ rank: 4, fid: 4, points: 70 }),
        leaderboardEntry({ rank: 5, fid: 5, points: 60 }),
      ],
    };
    vi.mocked(getCurrentMonthLeaderboard).mockResolvedValue(result);

    const ctx = await loadStandingsSnapContext(99);

    expect(ctx?.entries).toHaveLength(6);
    const appended = ctx?.entries[5];
    expect(appended).toEqual({
      rank: 12,
      label: "Maximus",
      points: 40,
      isUser: true,
    });
  });

  it("builds a single user row from status when the leaderboard is empty", async () => {
    vi.mocked(getCurrentMonthLeaderboard).mockResolvedValue({
      month: "2025-06",
      entries: [],
    });

    const ctx = await loadStandingsSnapContext(99);

    expect(ctx?.entries).toHaveLength(1);
    expect(ctx?.entries[0]).toEqual({
      rank: 12,
      label: "Maximus",
      points: 40,
      isUser: true,
    });
  });

  it("returns null when status cannot be loaded", async () => {
    vi.mocked(loadStatusViewContext).mockResolvedValue(null);
    vi.mocked(getCurrentMonthLeaderboard).mockResolvedValue({
      month: "2025-06",
      entries: [],
    });

    await expect(loadStandingsSnapContext(99)).resolves.toBeNull();
  });
});
