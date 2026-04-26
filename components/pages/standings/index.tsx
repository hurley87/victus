"use client";

import { ScoringTable } from "@/components/shared/ui/scoring-table";
import { Button } from "@/components/shared/ui/button";
import { ShareComposeGlyph } from "@/components/shared/ui/share-compose-glyph";
import { useUser } from "@/contexts/user-context";
import { useApiQuery } from "@/hooks/use-api-query";
import { useShareCast, type ShareController } from "@/hooks/use-share-cast";
import { miniAppTabDeepLink } from "@/lib/commodus/deep-links";
import type {
  CurrentLeaderboardResult,
  LeaderboardEntry,
  RecentActivityEntry,
  RecentActivityResult,
} from "@/lib/leaderboard/service";
import { cn, formatUsd } from "@/lib/utils";
import { Crown, Swords } from "lucide-react";

const RANK_MEDALS: Record<number, string> = {
  1: "🏆",
  2: "🥈",
  3: "🥉",
};

function farcasterUserLabel(
  username: string | null | undefined,
  fid: number,
): string {
  return username ? `@${username}` : `fid ${fid}`;
}

export default function StandingsPage() {
  const { user } = useUser();
  const viewerFid = user?.data ? Number(user.data.fid) : -1;
  const sharing = useShareCast();

  const { data, isLoading, error, refetch } =
    useApiQuery<CurrentLeaderboardResult>({
      queryKey: ["leaderboard-current"],
      url: "/api/leaderboard/current",
      isProtected: true,
      retry: false,
    });
  const { data: activity } = useApiQuery<RecentActivityResult>({
    queryKey: ["leaderboard-recent-activity"],
    url: "/api/leaderboard/recent-activity",
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
  const viewerPlayerIndex = viewerEntry
    ? playerEntries.findIndex((row) => row.user_id === viewerEntry.user_id)
    : -1;
  const nextPlayerEntry =
    viewerPlayerIndex > 0 ? playerEntries[viewerPlayerIndex - 1] : undefined;

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

      {commodusEntry && (
        <CommodusBossCard
          commodus={commodusEntry}
          viewer={viewerEntry}
          sharing={sharing}
        />
      )}

      {viewerEntry && (
        <ViewerShareCard
          viewer={viewerEntry}
          nextPlayer={nextPlayerEntry}
          sharing={sharing}
        />
      )}

      {sharing.error && (
        <p className="text-xs text-pnl-negative">{sharing.error}</p>
      )}

      {activity && activity.recent.length > 0 && (
        <RecentActivityCard activity={activity} />
      )}

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
          playerEntries.map((row) => (
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

function SignedUsdPnl({
  amount,
  className,
}: {
  amount: number;
  className?: string;
}) {
  const isNonNegative = amount >= 0;
  return (
    <span
      className={cn(
        "font-mono text-sm",
        isNonNegative ? "text-pnl-positive" : "text-pnl-negative",
        className,
      )}
    >
      {isNonNegative ? "+" : ""}
      {formatUsd(amount)}
    </span>
  );
}

function RankCell({ rank }: { rank: number }) {
  const medal = RANK_MEDALS[rank];
  if (medal) {
    return <span className="text-base leading-none">{medal}</span>;
  }
  return <span className="font-mono text-sm text-zinc-400">{rank}</span>;
}

function CommodusBossCard({
  commodus,
  viewer,
  sharing,
}: {
  commodus: LeaderboardEntry;
  viewer: LeaderboardEntry | undefined;
  sharing: ShareController;
}) {
  const pnl = commodus.realized_pnl_usdc;
  const viewerAhead = viewer != null && viewer.points > commodus.points;
  let statusText: string;
  if (viewer == null) {
    statusText = "Score your first trade to start chasing him";
  } else if (viewerAhead) {
    statusText = "You are ahead of Commodus";
  } else {
    statusText = `You need ${commodus.points - viewer.points + 1} more pts to pass him`;
  }
  const challengeLink = miniAppTabDeepLink("trade", { mode: "buy", amount: 5 });
  const showShare = sharing.canCompose && viewer != null;
  const shareKey = viewerAhead ? "commodus-defeated" : "commodus-boss";
  const shareText =
    viewerAhead && viewer
      ? `I have beaten Commodus in the Victus arena (${viewer.points} vs ${commodus.points} pts).\n\n${miniAppTabDeepLink("standings")}`
      : `Commodus sits at ${commodus.points} pts (#${commodus.rank}) in the arena. Think you can pass him?\n\n${challengeLink}`;
  const shareLabel = viewerAhead ? "Share the kill" : "Challenge a friend";

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
            <SignedUsdPnl amount={pnl} />
          </div>
        </div>
      </div>

      {showShare && (
        <Button
          type="button"
          variant="imperial-outline"
          className="mt-3 min-h-11 w-full justify-center gap-2 rounded-lg border-gold/40 text-sm text-gold hover:bg-gold/10"
          disabled={sharing.pending !== null}
          onClick={() => void sharing.share(shareKey, shareText)}
        >
          <ShareComposeGlyph isPending={sharing.pending === shareKey} />
          {shareLabel}
        </Button>
      )}
    </section>
  );
}

function ViewerShareCard({
  viewer,
  nextPlayer,
  sharing,
}: {
  viewer: LeaderboardEntry;
  nextPlayer: LeaderboardEntry | undefined;
  sharing: ShareController;
}) {
  const shareKey = `viewer-${viewer.user_id}`;
  const shareText = `I'm #${viewer.rank} in the Victus arena with ${viewer.points} pts.\n\n${miniAppTabDeepLink("standings")}`;
  const nextLabel = nextPlayer
    ? farcasterUserLabel(nextPlayer.username, nextPlayer.fid)
    : null;
  const gapToNext = nextPlayer ? nextPlayer.points - viewer.points + 1 : 0;

  return (
    <section className="rounded-xl border border-imperial-border bg-imperial-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gold-muted">
            Your standing
          </p>
          <p className="truncate text-sm text-zinc-200">
            #{viewer.rank} · {viewer.points} pts
          </p>
          {nextPlayer && (
            <p className="truncate text-xs text-zinc-400">
              {gapToNext} pts to pass {nextLabel}
            </p>
          )}
        </div>
        {sharing.canCompose && (
          <Button
            type="button"
            variant="imperial-outline"
            className="min-h-11 shrink-0 gap-2 rounded-lg border-gold/40 text-sm text-gold hover:bg-gold/10"
            disabled={sharing.pending !== null}
            onClick={() => void sharing.share(shareKey, shareText)}
          >
            <ShareComposeGlyph isPending={sharing.pending === shareKey} />
            Share rank
          </Button>
        )}
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
  const playerLabel = farcasterUserLabel(row.username, row.fid);
  const pnl = row.realized_pnl_usdc;

  return (
    <div
      className={cn(
        "grid grid-cols-[2.5rem_1fr_5rem_6rem] items-center px-3 py-3 border-b border-imperial-border last:border-b-0",
        isViewer && "bg-gold/10",
      )}
    >
      <div className="flex items-center">
        <RankCell rank={row.rank} />
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
        <SignedUsdPnl amount={pnl} />
      </div>
    </div>
  );
}

function RecentActivityCard({ activity }: { activity: RecentActivityResult }) {
  return (
    <section className="rounded-xl border border-imperial-border bg-imperial-surface p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-gold-muted">
          Recent activity
        </h2>
        {activity.active_today > 0 && (
          <span className="rounded-md border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
            {activity.active_today} active today
          </span>
        )}
      </div>
      <ul className="space-y-1.5">
        {activity.recent.map((entry) => (
          <RecentActivityRow key={entry.execution_id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function RecentActivityRow({ entry }: { entry: RecentActivityEntry }) {
  const playerLabel = farcasterUserLabel(entry.username, entry.fid);
  const symbol = entry.symbol ? `$${entry.symbol.toUpperCase()}` : "";
  const ago = relativeTimeShort(entry.confirmed_at);
  const points = entry.points;
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <div className="min-w-0 truncate text-zinc-200">
        <span className="font-medium">{playerLabel}</span>
        <span className="text-zinc-500"> · {entry.action} </span>
        <span className="font-mono">{symbol}</span>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {points !== 0 && (
          <span
            className={cn(
              "font-mono",
              points > 0 ? "text-pnl-positive" : "text-zinc-400",
            )}
          >
            {points > 0 ? `+${points}` : points} pts
          </span>
        )}
        <span className="text-zinc-500">{ago}</span>
      </div>
    </li>
  );
}

function relativeTimeShort(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
