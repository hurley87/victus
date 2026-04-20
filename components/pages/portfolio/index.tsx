"use client";

import { useEnvironment } from "@/contexts/environment-context";
import { useFarcaster } from "@/contexts/farcaster-context";
import { useUser } from "@/contexts/user-context";
import { useApiQuery } from "@/hooks/use-api-query";
import type { PortfolioResult } from "@/lib/portfolio/service";
import { formatUsd } from "@/lib/utils";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Website } from "../website";
import { Button } from "@/components/shared/ui/button";

function parseFidQuery(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

export default function PortfolioPage() {
  const { isInBrowser } = useEnvironment();
  const { context } = useFarcaster();
  const { user, isSignedIn, signIn, isLoading: isSigningIn } = useUser();
  const searchParams = useSearchParams();
  const fidFromUrl = parseFidQuery(searchParams.get("fid"));
  const fidParamInvalid =
    searchParams.has("fid") && fidFromUrl === null;

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
        <h1 className="text-2xl font-semibold mb-2">Portfolio</h1>
        <p className="text-sm text-muted-foreground mb-4 text-center">
          Sign in to view holdings and trade history.
        </p>
        <Button onClick={signIn} disabled={isSigningIn}>
          {isSigningIn ? "Signing in…" : "Sign in"}
        </Button>
      </div>
    );
  }

  if (fidParamInvalid) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white text-black p-4 gap-2">
        <p className="text-sm text-red-600 text-center">
          This portfolio link is invalid (check the <code className="font-mono">fid</code>{" "}
          in the URL).
        </p>
        <Button variant="outline" asChild>
          <Link href="/portfolio">Open your portfolio</Link>
        </Button>
      </div>
    );
  }

  const viewerFid = user.data.fid;
  const targetFid = fidFromUrl != null ? String(fidFromUrl) : viewerFid;
  const isViewingOther =
    fidFromUrl != null && String(fidFromUrl) !== String(viewerFid);

  return (
    <PortfolioContent
      targetFid={targetFid}
      viewerUsername={user.data.username}
      isViewingOther={isViewingOther}
    />
  );
}

function PortfolioContent({
  targetFid,
  viewerUsername,
  isViewingOther,
}: {
  targetFid: string;
  viewerUsername: string;
  isViewingOther: boolean;
}) {
  const { data, isLoading, error, refetch } = useApiQuery<PortfolioResult>({
    queryKey: ["portfolio", targetFid],
    url: `/api/users/${targetFid}/portfolio`,
    isProtected: true,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-black">
        Loading portfolio…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white text-black p-4 gap-3">
        <p className="text-sm text-red-600">Couldn&apos;t load portfolio.</p>
        <Button variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const handle =
    data.username != null && data.username !== ""
      ? data.username
      : isViewingOther
        ? null
        : viewerUsername;
  const title =
    data.gladiator_name ??
    (data.display_name || (handle ? `@${handle}` : `fid ${targetFid}`));

  return (
    <div className="bg-white text-black min-h-screen flex flex-col items-center p-4">
      <div className="w-full max-w-lg space-y-5 pt-8">
        {isViewingOther ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            role="status"
          >
            Viewing this gladiator&apos;s ledger (shared link).{" "}
            <Link href="/portfolio" className="font-medium text-purple-800 underline">
              Open your portfolio
            </Link>
            .
          </div>
        ) : null}
        <header className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">
              @{handle ?? `fid ${targetFid}`} · Realized PnL (closed sells)
            </p>
          </div>
          <Link
            href="/leaderboard"
            className="text-sm text-purple-700 hover:underline shrink-0"
          >
            Leaderboard
          </Link>
        </header>

        <section className="rounded-xl border border-black/10 p-4 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-black/60">
            Realized PnL
          </h2>
          <div className="flex justify-between text-sm">
            <span className="text-black/70">This month</span>
            <span className="font-mono font-medium">
              {formatUsd(data.realized_pnl_month_usdc)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-black/70">All time</span>
            <span className="font-mono font-medium">
              {formatUsd(data.realized_pnl_all_time_usdc)}
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-black/10 p-4 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-black/60">
            Holdings
          </h2>
          {data.holdings.length === 0 ? (
            <p className="text-sm text-black/60">No open positions.</p>
          ) : (
            <ul className="divide-y divide-black/10">
              {data.holdings.map((h) => (
                <li
                  key={h.symbol}
                  className="py-2 flex justify-between gap-2 text-sm"
                >
                  <div>
                    <span className="font-mono font-medium">{h.symbol}</span>
                    <span className="block text-[11px] text-black/50">
                      {h.quantity.toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })}{" "}
                      · avg {formatUsd(h.avg_cost_usdc)}
                    </span>
                  </div>
                  <div className="text-right font-mono text-xs">
                    <div>{formatUsd(h.value_usdc)}</div>
                    <div className="text-[10px] text-black/45">at-cost</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-black/10 p-4 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-black/60">
            Recent trades
          </h2>
          {data.recent_trades.length === 0 ? (
            <p className="text-sm text-black/60">No trades yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.recent_trades.map((t) => (
                <li
                  key={t.id}
                  className="rounded-lg bg-black/[0.02] px-3 py-2 text-xs"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-mono uppercase">{t.action}</span>
                    <span className="text-black/60">
                      {t.confirmed_at
                        ? new Date(t.confirmed_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </span>
                  </div>
                  <div className="font-mono text-black/80 mt-0.5">
                    {t.symbol}
                    {t.notional_usdc != null && (
                      <span> · {formatUsd(t.notional_usdc)}</span>
                    )}
                    {t.action === "sell" && t.realized_pnl_usdc != null && (
                      <span className="text-black/70">
                        {" "}
                        · PnL {formatUsd(t.realized_pnl_usdc)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Link
          href="/arena"
          className="inline-block text-sm text-purple-700 hover:underline"
        >
          ← Back to Arena
        </Link>
      </div>
    </div>
  );
}
