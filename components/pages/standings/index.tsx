"use client";

import { ScoringTable } from "@/components/shared/ui/scoring-table";
import { Button } from "@/components/shared/ui/button";
import { useUser } from "@/contexts/user-context";
import { useApiQuery } from "@/hooks/use-api-query";
import type { CurrentLeaderboardResult, LeaderboardEntry } from "@/lib/leaderboard/service";
import { cn, formatUsd } from "@/lib/utils";
import { Crown, Swords } from "lucide-react";

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

  const commodusEntry = data.entries.find((row) => row.is_commodus);
  const playerEntries = data.entries.filter((row) => !row.is_commodus);
  const viewerEntry = data.entries.find((row) => row.fid === viewerFid);

  return (
    <div className="text-white space-y-6 pt-4">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl uppercase tracking-wider text-gold">
          Standings
        </h1>
        <p className="text-xs text-zinc-400">
          Rankings are based on monthly scoring. The table resets each calendar
          month in UTC.
        </p>
        <p className="text-xs text-zinc-300">
          Pass the emperor, then climb the player board.
        </p>
      </header>

      {commodusEntry ? (
        <CommodusBossCard commodus={commodusEntry} viewer={viewerEntry} />
      ) : null}

      <div className="rounded-xl border border-imperial-border overflow-hidden bg-imperial-surface">
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

        {playerEntries.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-zinc-500">
            No player scores yet this month.
          </div>
        ) : (
          playerEntries.map((row: LeaderboardEntry) => (
            <StandingsRow
              key={row.user_id}
              row={row}
              isViewer={row.fid === viewerFid}
            />
          ))
        )}
      </div>

      <ScoringTable />
    </div>
  );
}

function CommodusBossCard({
  commodus,
  viewer,
}: {
  commodus: LeaderboardEntry;
  viewer: LeaderboardEntry | undefined;
}) {
  const pnl = commodus.realized_pnl_usdc;
  const pnlPositive = pnl >= 0;
  let statusText: string;
  if (viewer == null) {
    statusText = "Score your first trade to start chasing him";
  } else if (viewer.points > commodus.points) {
    statusText = "You are ahead of Commodus";
  } else {
    statusText = `You need ${commodus.points - viewer.points + 1} more pts to pass him`;
  }

  return (
    <section className="overflow-hidden rounded-xl border border-gold/40 bg-[linear-gradient(135deg,rgba(200,168,78,0.18),rgba(20,20,20,0.96)_44%,rgba(0,0,0,0.92))] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.34),0_0_32px_rgba(200,168,78,0.12)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-9 items-center justify-center rounded-lg border border-gold/40 bg-black/35 text-gold">
              <Crown className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gold-muted">
                Beat Commodus
              </p>
              <h2 className="truncate font-serif text-xl uppercase tracking-wider text-white">
                Commodus
              </h2>
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-md border border-gold/30 bg-gold/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gold">
            <Swords className="size-3.5" aria-hidden="true" />
            Emperor benchmark
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="font-mono text-3xl font-semibold leading-none text-gold">
            {commodus.points}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            pts
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-gold/20 bg-black/25 p-3">
        <p className="text-sm font-medium text-white">{statusText}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Rank
            </p>
            <p className="font-mono text-sm text-zinc-200">#{commodus.rank}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Monthly PnL
            </p>
            <p
              className={cn(
                "font-mono text-sm",
                pnlPositive ? "text-pnl-positive" : "text-pnl-negative",
              )}
            >
              {pnlPositive ? "+" : ""}
              {formatUsd(pnl)}
            </p>
          </div>
        </div>
      </div>
    </section>
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
  const playerLabel = row.username
    ? `@${row.username}`
    : `fid ${row.fid}`;
  const pnl = row.realized_pnl_usdc;
  const pnlPositive = pnl >= 0;

  return (
    <div
      className={cn(
        "grid grid-cols-[2.5rem_1fr_5rem_6rem] items-center px-3 py-3 border-b border-imperial-border last:border-b-0",
        isViewer && "bg-gold/10",
      )}
    >
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

      <div className="min-w-0">
        <span className="block truncate text-sm font-medium text-white">
          {playerLabel}
        </span>
      </div>

      <div className="text-right">
        <span className="font-mono text-sm text-white">{row.points}</span>
        <span className="text-[10px] text-zinc-500 ml-0.5">pts</span>
      </div>

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
