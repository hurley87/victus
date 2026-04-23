"use client";

import { ScoringTable } from "@/components/shared/ui/scoring-table";
import { Button } from "@/components/shared/ui/button";
import { useUser } from "@/contexts/user-context";
import { useApiQuery } from "@/hooks/use-api-query";
import type { CurrentLeaderboardResult, LeaderboardEntry } from "@/lib/leaderboard/service";
import { cn, formatUsd } from "@/lib/utils";

const RANK_MEDALS: Record<number, string> = {
  1: "🏆",
  2: "🥈",
  3: "🥉",
};

export default function StandingsPage() {
  const { user } = useUser();
  const viewerFid = user?.data ? Number(user.data.fid) : -1;

  const { data, isLoading, error, refetch } =
    useApiQuery<CurrentLeaderboardResult>({
      queryKey: ["leaderboard-current"],
      url: "/api/leaderboard/current",
      isProtected: true,
      retry: false,
    });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <p className="text-sm text-pnl-negative">
          {error?.message ?? "Could not load standings."}
        </p>
        <Button variant="imperial-outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="text-white space-y-6 pt-4">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="font-serif text-2xl uppercase tracking-wider text-gold">
            Standings
          </h1>
          <p className="text-xs text-zinc-400">
            Rankings are based on monthly scoring. The table resets each calendar
            month in UTC.
          </p>
        </header>

        {/* Leaderboard table */}
        <div className="rounded-xl border border-imperial-border overflow-hidden bg-imperial-surface">
          {/* Header row */}
          <div className="grid grid-cols-[2.5rem_1fr_5rem_6rem] border-b border-imperial-border px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gold-muted">
              Rank
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gold-muted">
              User
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gold-muted text-right">
              Score
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gold-muted text-right">
              Monthly PnL
            </span>
          </div>

          {/* Data rows */}
          {data.entries.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-zinc-500">
              No scores yet this month.
            </div>
          ) : (
            data.entries.map((row: LeaderboardEntry) => (
              <StandingsRow
                key={row.user_id}
                row={row}
                isViewer={row.fid === viewerFid}
              />
            ))
          )}
        </div>

        {/* Scoring section */}
        <ScoringTable />
    </div>
  );
}

function StandingsRow({
  row,
  isViewer,
}: {
  row: LeaderboardEntry;
  isViewer: boolean;
}) {
  const medal = RANK_MEDALS[row.rank];
  const isTopThree = row.rank <= 3;
  const gladiatorLabel = row.gladiator_name ?? (row.username ? `@${row.username}` : `fid ${row.fid}`);
  const pnl = row.realized_pnl_usdc;
  const pnlPositive = pnl >= 0;

  return (
    <div
      className={cn(
        "grid grid-cols-[2.5rem_1fr_5rem_6rem] items-center px-3 py-3 border-b border-imperial-border last:border-b-0",
        isViewer && "bg-gold/10",
      )}
    >
      {/* Rank */}
      <div className="flex items-center">
        {medal ? (
          <span className="text-base leading-none">{medal}</span>
        ) : (
          <span
            className={cn(
              "font-mono text-sm",
              isTopThree ? "text-gold font-semibold" : "text-zinc-400",
            )}
          >
            {row.rank}
          </span>
        )}
      </div>

      {/* User */}
      <div className="min-w-0">
        <span className="block truncate text-sm font-medium text-white">
          {gladiatorLabel}
        </span>
        {row.username && row.gladiator_name && (
          <span className="block text-[11px] text-zinc-500 truncate">
            @{row.username}
          </span>
        )}
      </div>

      {/* Score */}
      <div className="text-right">
        <span className="font-mono text-sm text-white">{row.points}</span>
        <span className="text-[10px] text-zinc-500 ml-0.5">pts</span>
      </div>

      {/* PnL */}
      <div className="text-right">
        <span
          className={cn(
            "font-mono text-sm",
            pnlPositive ? "text-pnl-positive" : "text-pnl-negative",
          )}
        >
          {pnlPositive ? "+" : ""}
          {formatUsd(pnl)}
        </span>
      </div>
    </div>
  );
}
