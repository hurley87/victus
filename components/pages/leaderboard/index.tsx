"use client";

import { useEnvironment } from "@/contexts/environment-context";
import { useFarcaster } from "@/contexts/farcaster-context";
import { useUser } from "@/contexts/user-context";
import { useApiQuery } from "@/hooks/use-api-query";
import { useShareCast, type ShareController } from "@/hooks/use-share-cast";
import type { ReferralSummary } from "@/lib/referrals/types";
import type { SeasonLeaderboardResult } from "@/lib/seasons/leaderboard";
import { cn, formatUsd } from "@/lib/utils";
import Link from "next/link";
import { Website } from "../website";
import { Button } from "@/components/shared/ui/button";
import { ShareComposeGlyph } from "@/components/shared/ui/share-compose-glyph";

function leaderboardPlayerLabel(
  isCommodus: boolean,
  username: string | null,
  fid: number,
): string {
  if (isCommodus) return "Commodus (Emperor)";
  if (username) return `@${username}`;
  return `fid ${fid}`;
}

function seasonLeaderboardSubtitle(status: string | undefined): string {
  if (status === "settled") return "Final results";
  return "Arena Balance, not Wallet Balance";
}

export default function LeaderboardPage() {
  const { isInBrowser } = useEnvironment();
  const { context } = useFarcaster();
  const { user, isSignedIn, signIn, isLoading: isSigningIn } = useUser();

  if (isInBrowser) {
    return <Website />;
  }

  if (!context) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-black">
        Loading Mini App…
      </div>
    );
  }

  if (!isSignedIn || !user.data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white text-black p-4">
        <h1 className="text-2xl font-semibold mb-2">Leaderboard</h1>
        <p className="text-sm text-muted-foreground mb-4 text-center">
          Sign in to see standings and highlight your row.
        </p>
        <Button onClick={signIn} disabled={isSigningIn}>
          {isSigningIn ? "Signing in…" : "Sign in"}
        </Button>
      </div>
    );
  }

  const viewerFid = Number(user.data.fid);
  return <LeaderboardContent viewerFid={viewerFid} />;
}

function LeaderboardContent({ viewerFid }: { viewerFid: number }) {
  const sharing = useShareCast();
  const { data, isLoading, error, refetch } = useApiQuery<SeasonLeaderboardResult>({
    queryKey: ["leaderboard-season"],
    url: "/api/leaderboard/season",
    isProtected: true,
    retry: false,
  });
  const { data: referrals } = useApiQuery<ReferralSummary>({
    queryKey: ["referrals-me"],
    url: "/api/referrals/me",
    isProtected: true,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-black">
        Loading leaderboard…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white text-black p-4 gap-3">
        <p className="text-sm text-red-600">Couldn&apos;t load leaderboard.</p>
        <Button variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-white text-black min-h-screen flex flex-col items-center p-4">
      <div className="w-full max-w-lg space-y-4 pt-8">
        <header className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Leaderboard</h1>
            <p className="text-sm text-muted-foreground">
              {data.season?.name ?? "No active season"} ·{" "}
              {seasonLeaderboardSubtitle(data.season?.status)}
            </p>
          </div>
          <Link
            href="/arena"
            className="text-sm text-purple-700 hover:underline shrink-0"
          >
            Arena
          </Link>
        </header>

        {referrals && <ReferralCard referrals={referrals} sharing={sharing} />}

        {sharing.error && (
          <p className="text-xs text-red-600">{sharing.error}</p>
        )}

        <div className="rounded-xl border border-black/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-black/[0.03] text-left text-[11px] uppercase tracking-wide text-black/60">
                <th className="px-2 py-2 w-10">#</th>
                <th className="px-2 py-2">Player</th>
                <th className="px-2 py-2 text-right">Arena Balance</th>
                <th className="px-2 py-2 text-right">Return</th>
                <th className="px-2 py-2 text-right hidden sm:table-cell">
                  Trades
                </th>
              </tr>
            </thead>
            <tbody>
              {data.entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-black/60">
                    No qualified season entries yet.
                  </td>
                </tr>
              ) : (
                data.entries.map((row) => {
                  const isViewer = row.fid === viewerFid;
                  const isCommodus = row.is_commodus;
                  const label = leaderboardPlayerLabel(
                    isCommodus,
                    row.username,
                    row.fid,
                  );
                  return (
                    <tr
                      key={row.user_id}
                      className={cn(
                        "border-t border-black/10",
                        isViewer && "bg-purple-50",
                        isCommodus &&
                          "bg-amber-50/90 ring-1 ring-amber-400/30 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.15)]",
                      )}
                    >
                      <td className="px-2 py-2 font-mono text-black/70">
                        {row.rank ?? "—"}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium">{label}</span>
                            {isCommodus && (
                              <span
                                className="text-[10px] uppercase tracking-wide font-semibold text-amber-800 bg-amber-200/60 px-1.5 py-0.5 rounded"
                                title="System opponent, same rules as you"
                              >
                                Boss
                              </span>
                            )}
                          </div>
                          {data.season?.status === "settled" && (
                            <FinalScoreChips row={row} />
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono">
                        {formatUsd(row.portfolio_value_usdc)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">
                        {formatPercent(row.performance_return)}
                      </td>
                      <td className="px-2 py-2 text-right text-[11px] text-black/70 hidden sm:table-cell">
                        {row.trades_used}/{data.season?.max_trades ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {data.ineligible.length > 0 && (
          <section className="rounded-xl border border-black/10 overflow-hidden">
            <div className="bg-black/[0.03] px-3 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-black/60">
                Not qualified
              </h2>
              <p className="text-xs text-black/50">
                Needs a qualifying season trade and eligible status.
              </p>
            </div>
            {data.ineligible.map((row) => (
              <div
                key={row.user_id}
                className={cn(
                  "grid grid-cols-[1fr_6rem_5rem] gap-2 border-t border-black/10 px-3 py-2 text-sm",
                  row.fid === viewerFid && "bg-purple-50",
                  row.is_commodus && "bg-amber-50/90",
                )}
              >
                <span className="truncate">
                  {leaderboardPlayerLabel(row.is_commodus, row.username, row.fid)}
                </span>
                <span className="text-right font-mono">
                  {formatUsd(row.portfolio_value_usdc)}
                </span>
                <span className="text-right font-mono">
                  {data.season?.status === "settled"
                    ? `${row.final_score} pts`
                    : formatPercent(row.performance_return)}
                </span>
              </div>
            ))}
          </section>
        )}

        <Link
          href="/portfolio"
          className="inline-block text-sm text-purple-700 hover:underline"
        >
          View your portfolio →
        </Link>
      </div>
    </div>
  );
}

function FinalScoreChips({
  row,
}: {
  row: SeasonLeaderboardResult["entries"][number];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 pt-1">
      <ScoreChip label="Score" value={`${row.final_score}`} strong />
      <ScoreChip label="Rank" value={`${row.performance_points}`} />
      {row.survival_bonus > 0 && (
        <ScoreChip label="Survive" value={`+${row.survival_bonus}`} />
      )}
      {row.commodus_bonus > 0 && (
        <ScoreChip label="Beat Commodus" value={`+${row.commodus_bonus}`} />
      )}
    </div>
  );
}

function ScoreChip({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] leading-none",
        strong
          ? "border-black/20 bg-black text-white"
          : "border-black/10 bg-white text-black/60",
      )}
    >
      {label} {value}
    </span>
  );
}

function formatPercent(value: number): string {
  const percentage = value * 100;
  return `${percentage >= 0 ? "+" : ""}${percentage.toFixed(2)}%`;
}

function ReferralCard({
  referrals,
  sharing,
}: {
  referrals: ReferralSummary;
  sharing: ShareController;
}) {
  const shareKey = "leaderboard-referrals";
  const shareText = `Join Victus. Fund your arena wallet and climb the standings.\n\n${referrals.referralUrl}`;

  return (
    <section className="rounded-xl border border-black/10 bg-black/[0.03] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Invite players</h2>
          <p className="text-xs text-black/60">
            Earn {referrals.bonusPointsPerFunding} pts when a referral funds.
          </p>
          <p className="mt-1 truncate font-mono text-[11px] text-black/50">
            {referrals.referralUrl}
          </p>
        </div>
        {sharing.canCompose && (
          <Button
            type="button"
            variant="outline"
            className="min-h-10 shrink-0 gap-2"
            disabled={sharing.pending !== null}
            onClick={() => void sharing.share(shareKey, shareText)}
          >
            <ShareComposeGlyph isPending={sharing.pending === shareKey} />
            Share
          </Button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <ReferralStat label="Signups" value={referrals.signups} />
        <ReferralStat label="Funded" value={referrals.funded} />
        <ReferralStat label="Season bonus" value={referrals.seasonBonusPoints} />
      </div>
    </section>
  );
}

function ReferralStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white px-2 py-2">
      <p className="text-[10px] uppercase tracking-wide text-black/50">{label}</p>
      <p className="font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}
