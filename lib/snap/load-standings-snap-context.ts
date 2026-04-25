import "server-only";

import {
  getCurrentMonthLeaderboard,
  type LeaderboardEntry,
} from "@/lib/leaderboard/service";
import { loadStatusViewContext } from "@/lib/status/load-context";

import type {
  StandingsSnapContext,
  StandingsSnapEntry,
} from "./build-standings-snap";

function displayName(entry: LeaderboardEntry): string {
  return entry.username ? `@${entry.username}` : `fid ${entry.fid}`;
}

function toSnapEntry(
  entry: LeaderboardEntry,
  fid: number,
): StandingsSnapEntry {
  return {
    rank: entry.rank,
    label: displayName(entry),
    points: entry.points,
    isUser: entry.fid === fid,
  };
}

export async function loadStandingsSnapContext(
  fid: number,
): Promise<StandingsSnapContext | null> {
  const [status, leaderboard] = await Promise.all([
    loadStatusViewContext(fid),
    getCurrentMonthLeaderboard(),
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
            points: status.points,
            isUser: true,
          },
    );
  }

  if (entries.length === 0) {
    entries.push({
      rank: status.rank,
      label: status.displayHandle,
      points: status.points,
      isUser: true,
    });
  }

  return {
    displayHandle: status.displayHandle,
    entries,
  };
}
