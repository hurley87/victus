import "server-only";

import {
  getSeasonLeaderboard,
  type SeasonLeaderboardEntry,
} from "@/lib/seasons/leaderboard";
import { loadStatusViewContext } from "@/lib/status/load-context";

import type {
  StandingsSnapContext,
  StandingsSnapEntry,
} from "./build-standings-snap";

function displayName(entry: SeasonLeaderboardEntry): string {
  if (entry.is_commodus) {
    return "Commodus (Emperor)";
  }
  if (entry.username) {
    return `@${entry.username}`;
  }
  return `fid ${entry.fid}`;
}

function toSnapEntry(
  entry: SeasonLeaderboardEntry,
  fid: number,
): StandingsSnapEntry {
  return {
    rank: entry.rank,
    label: displayName(entry),
    arenaValueUsdc: entry.portfolio_value_usdc,
    performanceReturn: entry.performance_return,
    isUser: entry.fid === fid,
  };
}

export async function loadStandingsSnapContext(
  fid: number,
): Promise<StandingsSnapContext | null> {
  const [status, leaderboard] = await Promise.all([
    loadStatusViewContext(fid),
    getSeasonLeaderboard(),
  ]);

  if (!status) return null;

  const topFive = leaderboard.entries.slice(0, 5);
  const self = leaderboard.entries.find((entry) => entry.fid === fid);
  const topFiveHasSelf = topFive.some((entry) => entry.fid === fid);

  const entries = topFive.map((entry) => toSnapEntry(entry, fid));

  if (!topFiveHasSelf) {
    entries.push(
      self
        ? toSnapEntry(self, fid)
        : {
            rank: status.rank,
            label: status.displayHandle,
            arenaValueUsdc: status.arenaValueUsdc,
            performanceReturn: status.performanceReturn,
            isUser: true,
          },
    );
  }

  if (entries.length === 0) {
    entries.push({
      rank: status.rank,
      label: status.displayHandle,
      arenaValueUsdc: status.arenaValueUsdc,
      performanceReturn: status.performanceReturn,
      isUser: true,
    });
  }

  return {
    displayHandle: status.displayHandle,
    entries,
  };
}
