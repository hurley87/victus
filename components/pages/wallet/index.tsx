"use client";

import { useCallback, useMemo, useState } from "react";
import { useUser } from "@/contexts/user-context";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useApiQuery } from "@/hooks/use-api-query";
import { ApiError } from "@/lib/api-error";
import type {
  ArenaProfile,
  GladiatorSummary,
  ArenaBalance,
  MintGladiatorRequest,
  MintGladiatorResponse,
} from "@/lib/arena/types";
import type { PortfolioResult, PortfolioHolding, PortfolioTrade } from "@/lib/portfolio/service";
import { cn, formatUsd, formatWalletAddress, copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/shared/ui/button";
import { DepositButton } from "@/components/pages/arena/deposit-button";
import { WithdrawButton } from "@/components/pages/arena/withdraw-button";

const ARENA_QUERY_KEY = ["arena-me"] as const;

export default function WalletPage() {
  const { user } = useUser();
  const fid = user?.data?.fid;

  // Arena data — poll while pending_funding so the server self-heal surfaces quickly
  const {
    data: arena,
    isLoading: arenaLoading,
    error: arenaError,
    refetch: refetchArenaRaw,
  } = useApiQuery<ArenaProfile>({
    queryKey: ARENA_QUERY_KEY,
    url: "/api/arena/me",
    isProtected: true,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.needs_funding ? 5_000 : false,
  });

  // Portfolio data — only fetch once gladiator exists
  const { data: portfolio } = useApiQuery<PortfolioResult>({
    queryKey: ["portfolio", fid],
    url: `/api/users/${fid}/portfolio`,
    isProtected: true,
    retry: false,
    enabled: !!fid && !!arena?.gladiator,
  });

  const refetchArena = useCallback(() => {
    void refetchArenaRaw();
  }, [refetchArenaRaw]);

  if (arenaLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-zinc-500 text-sm">Loading...</p>
      </div>
    );
  }

  if (arenaError || !arena) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <p className="text-red-400 text-sm text-center">
          Couldn&apos;t load your wallet.
        </p>
        <Button variant="imperial-outline" onClick={refetchArena}>
          Try again
        </Button>
      </div>
    );
  }

  // --- Three-state mint flow ---

  if (!arena.gladiator) {
    return (
      <div className="pt-4">
        <PreMintCard
          suggestedName={arena.suggested_name ?? "gladiator"}
          minMintDepositUsdc={arena.rules.min_mint_deposit_usdc}
          onMinted={refetchArena}
        />
      </div>
    );
  }

  if (arena.needs_funding && arena.arena_address) {
    return (
      <div className="pt-4">
        <PendingFundingCard
          gladiator={arena.gladiator}
          arenaAddress={arena.arena_address}
          balance={arena.balance}
          minDepositUsdc={arena.rules.min_mint_deposit_usdc}
          onFundingConfirmed={refetchArena}
        />
      </div>
    );
  }

  if (arena.arena_address) {
    return (
      <AliveWalletView
        gladiator={arena.gladiator}
        arenaAddress={arena.arena_address}
        balance={arena.balance}
        withdrawDestinationAddress={arena.withdraw_destination?.address ?? null}
        portfolio={portfolio ?? null}
        onWithdrawn={refetchArena}
        onFundingConfirmed={refetchArena}
        minDepositUsdc={arena.rules.min_mint_deposit_usdc}
      />
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pre-mint card
// ---------------------------------------------------------------------------

function PreMintCard({
  suggestedName,
  minMintDepositUsdc,
  onMinted,
}: {
  suggestedName: string;
  minMintDepositUsdc: number;
  onMinted: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  const { mutate: mint, isPending } = useApiMutation<
    MintGladiatorResponse,
    MintGladiatorRequest
  >({
    url: "/api/gladiators/mint",
    method: "POST",
    body: () => ({}),
    onSuccess: () => {
      setFormError(null);
      onMinted();
    },
    onError: (err) => {
      setFormError(mapMintError(err));
    },
  });

  return (
    <section className="bg-imperial-surface rounded-xl border border-imperial-border p-4 space-y-3">
      <h2 className="text-lg font-serif font-semibold text-gold">
        Enter the Arena
      </h2>
      <p className="text-sm text-zinc-300">
        Commodus will mint a gladiator under your Farcaster handle and provision
        a custodial arena wallet on Base. Fund it with at least $
        {minMintDepositUsdc.toFixed(2)} USDC to unlock trading.
      </p>

      <div className="rounded-md border border-imperial-border bg-imperial-bg p-2">
        <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
          Gladiator name
        </p>
        <p className="font-mono text-sm text-zinc-200 break-all">
          {suggestedName}
        </p>
      </div>

      {formError && (
        <p className="text-xs text-red-400" role="alert">
          {formError}
        </p>
      )}

      <Button
        type="button"
        variant="imperial"
        className="w-full"
        onClick={() => {
          setFormError(null);
          mint({});
        }}
        disabled={isPending}
      >
        {isPending ? "Minting…" : "Mint gladiator"}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pending funding card
// ---------------------------------------------------------------------------

function PendingFundingCard({
  gladiator,
  arenaAddress,
  balance,
  minDepositUsdc,
  onFundingConfirmed,
}: {
  gladiator: GladiatorSummary;
  arenaAddress: string;
  balance: ArenaBalance;
  minDepositUsdc: number;
  onFundingConfirmed: () => void;
}) {
  const progressPct = Math.min(
    100,
    Math.round((balance.usdc / minDepositUsdc) * 100),
  );

  return (
    <section className="bg-imperial-surface rounded-xl border border-gold/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gold">
          Pending funding
        </span>
        <span className="text-[11px] text-gold/70 font-mono">
          {gladiator.name}
        </span>
      </div>

      <p className="text-sm text-zinc-300">
        Fund your gladiator with ≥ ${minDepositUsdc.toFixed(2)} USDC on Base.
        Trading unlocks as soon as the deposit confirms.
      </p>

      <DepositButton
        arenaAddress={arenaAddress}
        minDepositUsdc={minDepositUsdc}
        onFundingConfirmed={onFundingConfirmed}
      />

      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-zinc-400">
            ${balance.usdc.toFixed(2)} / ${minDepositUsdc.toFixed(2)} USDC
          </span>
          <span className="text-gold/80 font-mono">{progressPct}%</span>
        </div>
        <div
          className="h-2 w-full rounded-full bg-imperial-border overflow-hidden"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Funding progress"
        >
          <div
            className="h-full bg-gold transition-[width] duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <p className="text-[11px] text-zinc-500" aria-live="polite">
        Trading is disabled until your gladiator is alive.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Alive wallet view
// ---------------------------------------------------------------------------

function AliveWalletView({
  gladiator: _gladiator,
  arenaAddress,
  balance,
  withdrawDestinationAddress,
  portfolio,
  onWithdrawn,
  onFundingConfirmed,
  minDepositUsdc,
}: {
  gladiator: GladiatorSummary;
  arenaAddress: string;
  balance: ArenaBalance;
  withdrawDestinationAddress: string | null;
  portfolio: PortfolioResult | null;
  onWithdrawn: () => void;
  onFundingConfirmed: () => void;
  minDepositUsdc: number;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);

  const addressShort = useMemo(
    () => formatWalletAddress(arenaAddress),
    [arenaAddress],
  );

  const holdings: PortfolioHolding[] = portfolio?.holdings ?? [];
  const recentTrades: PortfolioTrade[] = portfolio?.recent_trades ?? [];

  return (
    <div className="space-y-5 pt-4">

        {/* Balance display */}
        <div className="text-center space-y-2">
          <p className="text-3xl font-bold text-white">
            {formatUsd(balance.usdc)}
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-400">
            <span className="font-mono text-zinc-500">USDC</span>
            <span className="text-zinc-600">·</span>
            <span className="font-mono">Base · {addressShort}</span>
            <button
              type="button"
              onClick={() => copyToClipboard(arenaAddress, setIsCopied)}
              aria-label="Copy arena address"
              className="text-zinc-500 hover:text-zinc-300 transition"
            >
              {isCopied ? (
                <span className="text-pnl-positive text-[11px]">Copied!</span>
              ) : (
                <CopyIcon />
              )}
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="imperial-outline"
            className="w-full"
            onClick={() => setShowDeposit((v) => !v)}
          >
            Fund Wallet
          </Button>
          <WithdrawButton
            balanceUsdc={balance.usdc}
            destinationAddress={withdrawDestinationAddress}
            onWithdrawn={onWithdrawn}
          />
        </div>

        {/* Deposit panel — collapses in when "Fund Wallet" is active */}
        {showDeposit && (
          <div className="bg-imperial-surface rounded-xl border border-imperial-border p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500 mb-3">
              Deposit USDC
            </p>
            <DepositButton
              arenaAddress={arenaAddress}
              minDepositUsdc={minDepositUsdc}
              onFundingConfirmed={() => {
                setShowDeposit(false);
                onFundingConfirmed();
              }}
            />
          </div>
        )}

        {/* PnL cards */}
        <div className="grid grid-cols-2 gap-3">
          <PnlCard
            label="THIS MONTH"
            sublabel="Closed performance for the current scoring month."
            value={portfolio?.realized_pnl_month_usdc ?? 0}
          />
          <PnlCard
            label="ALL TIME"
            sublabel="Lifetime realized result across completed sells."
            value={portfolio?.realized_pnl_all_time_usdc ?? 0}
          />
        </div>

        {/* Holdings */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
              Holdings
            </h2>
            {holdings.length > 0 && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-gold/40 text-gold bg-gold/10">
                {holdings.length} OPEN
              </span>
            )}
          </div>

          {holdings.length === 0 ? (
            <p className="text-sm text-zinc-500">No open positions.</p>
          ) : (
            <ul className="space-y-2">
              {holdings.map((h) => (
                <HoldingRow key={h.symbol} holding={h} />
              ))}
            </ul>
          )}
        </section>

        {/* Recent Activity */}
        <section className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
            Recent Activity
          </h2>

          {recentTrades.length === 0 ? (
            <p className="text-sm text-zinc-500">No trades yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentTrades.map((t) => (
                <TradeRow key={t.id} trade={t} />
              ))}
            </ul>
          )}
        </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PnlCard({
  label,
  sublabel,
  value,
}: {
  label: string;
  sublabel: string;
  value: number;
}) {
  const isPositive = value >= 0;
  return (
    <div className="bg-imperial-surface rounded-xl border border-imperial-border p-3 space-y-1">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p
        className={cn(
          "text-lg font-bold font-mono",
          isPositive ? "text-pnl-positive" : "text-pnl-negative",
        )}
      >
        {isPositive ? "+" : ""}
        {formatUsd(value)}
      </p>
      <p className="text-[10px] text-zinc-600 mt-1 leading-tight">{sublabel}</p>
    </div>
  );
}

function HoldingRow({ holding }: { holding: PortfolioHolding }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="font-semibold text-white text-sm">{holding.symbol}</span>
      <div className="text-right">
        <p className="text-sm font-mono text-zinc-300">
          {holding.quantity.toLocaleString(undefined, {
            maximumFractionDigits: 6,
          })}
        </p>
        <p className="text-[11px] text-zinc-500">
          avg {formatUsd(holding.avg_cost_usdc)}
        </p>
      </div>
    </li>
  );
}

function TradeRow({ trade }: { trade: PortfolioTrade }) {
  const isBuy = trade.action === "buy";
  const actionLabel = isBuy
    ? `Buy ${trade.symbol}`
    : `Sell ${trade.symbol}`;

  const amountStr =
    trade.notional_usdc != null
      ? isBuy
        ? `+${formatUsd(trade.notional_usdc)}`
        : `-${formatUsd(trade.notional_usdc)}`
      : "—";

  const dateStr = trade.confirmed_at
    ? new Date(trade.confirmed_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <li className="rounded-lg bg-imperial-surface border border-imperial-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "size-6 rounded-full flex items-center justify-center shrink-0",
              isBuy ? "bg-pnl-positive/20" : "bg-pnl-negative/20",
            )}
          >
            <span
              className={cn(
                "text-[10px] font-bold",
                isBuy ? "text-pnl-positive" : "text-pnl-negative",
              )}
            >
              {isBuy ? "↑" : "↓"}
            </span>
          </div>
          <span className="text-sm text-white font-medium">{actionLabel}</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-400">{dateStr}</p>
          <p
            className={cn(
              "text-sm font-mono font-medium",
              isBuy ? "text-pnl-positive" : "text-pnl-negative",
            )}
          >
            {amountStr}
          </p>
        </div>
      </div>
    </li>
  );
}

function CopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-3.5"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2Zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6Z"
        clipRule="evenodd"
      />
      <path d="M2 4H1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1H9v1H1V5h1V4Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function mapMintError(err: Error): string {
  const status = err instanceof ApiError ? err.status : 0;
  switch (status) {
    case 401:
      return "Your session expired. Please sign in again.";
    case 503:
      return "Arena wallet provisioning is down. Try again shortly.";
    default:
      return "Couldn't mint your gladiator. Try again.";
  }
}
