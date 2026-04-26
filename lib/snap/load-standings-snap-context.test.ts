import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SeasonLeaderboardEntry,
  SeasonLeaderboardResult,
} from "@/lib/seasons/leaderboard";
import type { StatusViewContext } from "@/lib/status/load-context";

import { loadStandingsSnapContext } from "./load-standings-snap-context";

function leaderboardEntry(
  partial: Pick<SeasonLeaderboardEntry, "rank" | "fid"> &
    Partial<Omit<SeasonLeaderboardEntry, "rank" | "fid">>,
): SeasonLeaderboardEntry {
  return {
    user_id: `user-${partial.fid}`,
    season_entry_id: `entry-${partial.fid}`,
    username: null,
    portfolio_value_usdc: 10,
    performance_return: 0,
    cash_remaining_usdc: 10,
    starting_balance_usdc: 10,
    trades_used: 1,
    has_qualifying_trade: true,
    status: "active",
    is_commodus: false,
    performance_points: 0,
    survival_bonus: 0,
    commodus_bonus: 0,
    final_score: 0,
    ...partial,
  };
}

const baseStatus: StatusViewContext = {
  fid: 99,
  displayHandle: "Maximus",
  rank: 12,
  arenaValueUsdc: 4,
  performanceReturn: -0.6,
  dailySlotsRemaining: 3,
};

vi.mock("@/lib/seasons/leaderboard", () => ({
  getSeasonLeaderboard: vi.fn(),
}));

vi.mock("@/lib/status/load-context", () => ({
  loadStatusViewContext: vi.fn(),
}));

import { getSeasonLeaderboard } from "@/lib/seasons/leaderboard";
import { loadStatusViewContext } from "@/lib/status/load-context";

describe("loadStandingsSnapContext", () => {
  beforeEach(() => {
    vi.mocked(loadStatusViewContext).mockResolvedValue({ ...baseStatus });
  });

  it("returns top 5 with the user row marked when the user is in the top 5", async () => {
    const result: SeasonLeaderboardResult = {
      season: null,
      price_cache_ttl_seconds: 60,
      ineligible: [],
      entries: [
        leaderboardEntry({ rank: 1, fid: 1, portfolio_value_usdc: 100, username: "aurelius" }),
        leaderboardEntry({ rank: 2, fid: 2, portfolio_value_usdc: 90, username: "lucilla" }),
        leaderboardEntry({ rank: 3, fid: 99, portfolio_value_usdc: 85, username: "hero" }),
        leaderboardEntry({ rank: 4, fid: 4, portfolio_value_usdc: 70, username: "d" }),
        leaderboardEntry({ rank: 5, fid: 5, portfolio_value_usdc: 60, username: "e" }),
        leaderboardEntry({ rank: 6, fid: 6, portfolio_value_usdc: 50, username: "f" }),
      ],
    };
    vi.mocked(getSeasonLeaderboard).mockResolvedValue(result);

    const ctx = await loadStandingsSnapContext(99);

    expect(ctx).not.toBeNull();
    expect(ctx?.displayHandle).toBe("Maximus");
    expect(ctx?.entries).toHaveLength(5);
    const onlyUser = ctx?.entries.find((e) => e.isUser);
    expect(onlyUser).toBeDefined();
    expect(onlyUser).toMatchObject({
      rank: 3,
      label: "@hero",
      arenaValueUsdc: 85,
      isUser: true,
    });
  });

  it("appends the user row when they are not in the top 5 but appear on the leaderboard", async () => {
    const result: SeasonLeaderboardResult = {
      season: null,
      price_cache_ttl_seconds: 60,
      ineligible: [],
      entries: [
        leaderboardEntry({ rank: 1, fid: 1, portfolio_value_usdc: 100, username: "a" }),
        leaderboardEntry({ rank: 2, fid: 2, portfolio_value_usdc: 90, username: "b" }),
        leaderboardEntry({ rank: 3, fid: 3, portfolio_value_usdc: 80, username: "c" }),
        leaderboardEntry({ rank: 4, fid: 4, portfolio_value_usdc: 70, username: "d" }),
        leaderboardEntry({ rank: 5, fid: 5, portfolio_value_usdc: 60, username: "e" }),
        leaderboardEntry({ rank: 6, fid: 99, portfolio_value_usdc: 45, username: "maximus" }),
      ],
    };
    vi.mocked(getSeasonLeaderboard).mockResolvedValue(result);

    const ctx = await loadStandingsSnapContext(99);

    expect(ctx?.entries).toHaveLength(6);
    const appended = ctx?.entries[5];
    expect(appended).toMatchObject({
      rank: 6,
      label: "@maximus",
      arenaValueUsdc: 45,
      isUser: true,
    });
  });

  it("falls back to status when the user is not on the leaderboard list", async () => {
    const result: SeasonLeaderboardResult = {
      season: null,
      price_cache_ttl_seconds: 60,
      ineligible: [],
      entries: [
        leaderboardEntry({ rank: 1, fid: 1, portfolio_value_usdc: 100 }),
        leaderboardEntry({ rank: 2, fid: 2, portfolio_value_usdc: 90 }),
        leaderboardEntry({ rank: 3, fid: 3, portfolio_value_usdc: 80 }),
        leaderboardEntry({ rank: 4, fid: 4, portfolio_value_usdc: 70 }),
        leaderboardEntry({ rank: 5, fid: 5, portfolio_value_usdc: 60 }),
      ],
    };
    vi.mocked(getSeasonLeaderboard).mockResolvedValue(result);

    const ctx = await loadStandingsSnapContext(99);

    expect(ctx?.entries).toHaveLength(6);
    const appended = ctx?.entries[5];
    expect(appended).toEqual({
      rank: 12,
      label: "Maximus",
      arenaValueUsdc: 4,
      performanceReturn: -0.6,
      isUser: true,
    });
  });

  it("builds a single user row from status when the leaderboard is empty", async () => {
    vi.mocked(getSeasonLeaderboard).mockResolvedValue({
      season: null,
      price_cache_ttl_seconds: 60,
      entries: [],
      ineligible: [],
    });

    const ctx = await loadStandingsSnapContext(99);

    expect(ctx?.entries).toHaveLength(1);
    expect(ctx?.entries[0]).toEqual({
      rank: 12,
      label: "Maximus",
      arenaValueUsdc: 4,
      performanceReturn: -0.6,
      isUser: true,
    });
  });

  it("returns null when status cannot be loaded", async () => {
    vi.mocked(loadStatusViewContext).mockResolvedValue(null);
    vi.mocked(getSeasonLeaderboard).mockResolvedValue({
      season: null,
      price_cache_ttl_seconds: 60,
      entries: [],
      ineligible: [],
    });

    await expect(loadStandingsSnapContext(99)).resolves.toBeNull();
  });
});
