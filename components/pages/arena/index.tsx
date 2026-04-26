"use client";

import { useCallback, useMemo, useState } from "react";
import { useEnvironment } from "@/contexts/environment-context";
import { useFarcaster } from "@/contexts/farcaster-context";
import { useUser } from "@/contexts/user-context";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useApiQuery } from "@/hooks/use-api-query";
import type {
  ArenaBalance,
  ArenaProfile,
  ArenaRules,
  ProvisionArenaWalletResponse,
  PositionBalance,
} from "@/lib/arena/types";
import type {
  SeasonEnterResponse,
} from "@/app/api/season/enter/route";
import type { SeasonMeResponse } from "@/app/api/season/me/route";
import { ApiError } from "@/lib/api-error";
import { cn, copyToClipboard, formatUsd, formatWalletAddress } from "@/lib/utils";
import { Button } from "@/components/shared/ui/button";
import Link from "next/link";
import { DepositButton } from "./deposit-button";
import { WithdrawButton } from "./withdraw-button";
import { mapProvisionError } from "./provision-error";
import { Website } from "../website";

/**
 * Arena onboarding page. Three states driven by `GET /api/arena/me`:
 *
 *   - no wallet yet      → wallet provisioning + fund CTA
 *   - pending funding   → in-app deposit button + live progress meter
 *   - funded            → trading UI with live balance + rules + slots
 *
 * The page polls `/api/arena/me` while `needs_funding` is true so the
 * server-side self-heal (`getArenaProfile` sets `arena_wallets.funded_at`
 * when on-chain USDC clears the threshold) surfaces within ~5s of the
 * server's RPC seeing the deposit.
 */

const ARENA_QUERY_KEY = ["arena-me"] as const;
const SEASON_QUERY_KEY = ["season-me"] as const;

export default function ArenaPage() {
  const { isInBrowser } = useEnvironment();
  const { context } = useFarcaster();
  const { user, isSignedIn, signIn, isLoading: isSigningIn } = useUser();

  if (isInBrowser) {
    return <Website />;
  }

  if (!context) {
    return <Centered>Loading Mini App…</Centered>;
  }

  if (!isSignedIn || !user.data) {
    return (
      <Centered>
        <div className="space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Arena</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to enter the Arena.
          </p>
          <Button onClick={signIn} disabled={isSigningIn}>
            {isSigningIn ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </Centered>
    );
  }

  return <ArenaContent />;
}

function ArenaContent() {
  // Poll while pending_funding so the server-side self-heal surfaces on
  // the next tick. 5s is aggressive enough for demo UX and rounds to
  // ~zero cost at MVP scale.
  const { data, isLoading, error, refetch } = useApiQuery<ArenaProfile>({
    queryKey: ARENA_QUERY_KEY,
    url: "/api/arena/me",
    isProtected: true,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.needs_funding ? 5_000 : false,
  });

  const refetchArena = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (isLoading) {
    return <Centered>Loading your Arena…</Centered>;
  }

  if (error || !data) {
    return (
      <Centered>
        <div className="space-y-2 text-center">
          <p className="text-sm text-red-600">
            Couldn&apos;t load your Arena profile.
          </p>
          <Button variant="outline" onClick={refetchArena}>
            Try again
          </Button>
        </div>
      </Centered>
    );
  }

  return (
    <div className="bg-white text-black min-h-screen flex flex-col items-center p-4">
      <div className="w-full max-w-md space-y-6 pt-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Arena</h1>
          <p className="text-sm text-muted-foreground">
            Fund your wallet, make trades in the arena, and beat Commodus to
            earn rewards. Cast orders at{" "}
            <span className="font-mono">@commodus</span>;{" "}
            Commodus executes from your arena wallet with no per-trade wallet
            signature.
          </p>
        </header>

        {renderState(data, refetchArena)}

        <RulesCard rules={data.rules} />
      </div>
    </div>
  );
}

function renderState(profile: ArenaProfile, onChange: () => void) {
  if (!profile.wallet) {
    return (
      <PreFundingCard
        minFundingDepositUsdc={profile.rules.min_funding_deposit_usdc}
        onProvisioned={onChange}
      />
    );
  }
  if (profile.needs_funding && profile.arena_address) {
    return (
      <PendingFundingCard
        arenaAddress={profile.arena_address}
        balance={profile.balance}
        minDepositUsdc={profile.rules.min_funding_deposit_usdc}
        onFundingConfirmed={onChange}
      />
    );
  }
  if (profile.arena_address) {
    return (
      <>
        <AliveCard
          arenaAddress={profile.arena_address}
          balance={profile.balance}
          withdrawDestinationAddress={profile.withdraw_destination?.address ?? null}
          dailySlotsRemaining={profile.daily_slots_remaining}
          maxTradesPerDay={profile.rules.max_trades_per_day}
          maxTradeUsdc={profile.rules.max_trade_usdc}
          rules={profile.rules}
          onWithdrawn={onChange}
        />
        <SeasonSection walletUsdc={profile.balance.usdc} />
      </>
    );
  }
  return null;
}

function SeasonSection({ walletUsdc }: { walletUsdc: number }) {
  const { data, isLoading, refetch } = useApiQuery<SeasonMeResponse>({
    queryKey: SEASON_QUERY_KEY,
    url: "/api/season/me",
    isProtected: true,
    retry: false,
  });

  const refetchSeason = useCallback(() => {
    void refetch();
  }, [refetch]);

  const { mutate: enterSeason, isPending, error: enterError } =
    useApiMutation<SeasonEnterResponse, Record<string, never>>({
      url: "/api/season/enter",
      method: "POST",
      body: () => ({}),
      onSuccess: () => refetchSeason(),
    });

  if (isLoading || !data?.season) return null;

  const { season, entry, tokens } = data;
  const hasFunding = walletUsdc + 1e-9 >= season.starting_balance_usdc;

  if (!entry) {
    return (
      <SectionCard>
        <h2 className="text-sm font-semibold">{season.name}</h2>
        <p className="text-xs text-black/80">
          Every Victus week starts with the same {season.starting_balance_usdc}{" "}
          USDC arena balance. Your wallet may hold more funds, but extra funds
          do not increase your arena balance.
        </p>
        {!hasFunding && (
          <p className="text-xs text-amber-700">
            Fund your arena wallet with at least {season.starting_balance_usdc}{" "}
            USDC to enter.
          </p>
        )}
        {enterError && (
          <ErrorLine
            message={mapEnterError(enterError, season.starting_balance_usdc)}
          />
        )}
        <Button
          type="button"
          className="w-full"
          disabled={!hasFunding || isPending}
          onClick={() => enterSeason({})}
        >
          {isPending ? "Entering…" : `Enter ${season.name}`}
        </Button>
      </SectionCard>
    );
  }

  return <ArenaStatusCard season={season} entry={entry} tokens={tokens} />;
}

function ArenaStatusCard({
  season,
  entry,
  tokens,
}: {
  season: NonNullable<SeasonMeResponse["season"]>;
  entry: NonNullable<SeasonMeResponse["entry"]>;
  tokens: SeasonMeResponse["tokens"];
}) {
  const tradesRemaining = Math.max(0, entry.max_trades - entry.trades_used);
  const cashRemaining = Number(entry.cash_remaining_usdc);

  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Arena status — {season.name}</h2>
        <QualificationBadge qualified={entry.has_qualifying_trade} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat
          label="Starting balance"
          value={`${formatUsd(season.starting_balance_usdc)} USDC`}
        />
        <Stat label="Cash remaining" value={`${formatUsd(cashRemaining)} USDC`} />
        <Stat
          label="Trades remaining"
          value={`${tradesRemaining}/${entry.max_trades}`}
        />
        <Stat
          label="Min trade size"
          value={`${formatUsd(season.min_trade_size_usdc)} USDC`}
        />
      </div>

      {tokens.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            Approved tokens
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tokens.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-mono"
              >
                {t.token_symbol}
              </span>
            ))}
          </div>
        </div>
      )}

      <ul className="text-[11px] text-black/70 space-y-0.5">
        <li>Only trades made through Victus count toward your score.</li>
        <li>
          You must make at least one {formatUsd(season.min_trade_size_usdc)} USDC
          trade to qualify for weekly rewards.
        </li>
        <li>Trades are limited moves. You do not earn points for using more trades.</li>
      </ul>
    </SectionCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-black/[0.03] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function QualificationBadge({ qualified }: { qualified: boolean }) {
  const label = qualified ? "Qualified" : "Not qualified";
  const cls = qualified
    ? "bg-green-100 text-green-800"
    : "bg-black/5 text-black/60";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        cls,
      )}
    >
      {label}
    </span>
  );
}

function mapEnterError(err: unknown, startingBalance: number): string {
  const code = err instanceof ApiError ? err.message : null;
  switch (code) {
    case "insufficient_funding":
      return `Fund your arena wallet with at least ${startingBalance} USDC to enter.`;
    case "no_active_season":
      return "No active week is open right now.";
    case "needs_wallet_funding":
      return "Provision and fund your arena wallet first.";
    default:
      return "Could not enter the week. Try again.";
  }
}

function PreFundingCard({
  minFundingDepositUsdc,
  onProvisioned,
}: {
  minFundingDepositUsdc: number;
  onProvisioned: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  const { mutate: provisionWallet, isPending } = useApiMutation<
    ProvisionArenaWalletResponse,
    Record<string, never>
  >({
    url: "/api/arena/wallet",
    method: "POST",
    body: () => ({}),
    onSuccess: () => {
      setFormError(null);
      onProvisioned();
    },
    onError: (err) => {
      setFormError(mapProvisionError(err));
    },
  });

  return (
    <SectionCard>
      <h2 className="text-sm font-semibold">Fund your wallet</h2>
      <p className="text-xs text-muted-foreground">
        Fund your wallet, make trades in the arena, and beat Commodus to earn
        rewards. Add at least ${minFundingDepositUsdc.toFixed(2)} USDC on Base
        to unlock trading by casting at <span className="font-mono">@commodus</span>.
      </p>

      {formError && <ErrorLine message={formError} />}

      <Button
        type="button"
        className="w-full"
        onClick={() => {
          setFormError(null);
          provisionWallet({});
        }}
        disabled={isPending}
      >
        {isPending ? "Preparing wallet…" : "Fund wallet"}
      </Button>
    </SectionCard>
  );
}

function PendingFundingCard({
  arenaAddress,
  balance,
  minDepositUsdc,
  onFundingConfirmed,
}: {
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
    <section className="rounded-xl border border-amber-900/10 bg-amber-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">
          Wallet needs funding
        </span>
      </div>

      <p className="text-sm text-black/80">
        Fund your wallet with ≥ ${minDepositUsdc.toFixed(2)} USDC on
        Base. Trading unlocks as soon as the deposit confirms.
      </p>

      <DepositButton
        arenaAddress={arenaAddress}
        minDepositUsdc={minDepositUsdc}
        onFundingConfirmed={onFundingConfirmed}
      />

      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-black/80">
            ${balance.usdc.toFixed(2)} / ${minDepositUsdc.toFixed(2)} USDC
          </span>
          <span className="text-amber-800/80 font-mono">{progressPct}%</span>
        </div>
        <div
          className="h-2 w-full rounded-full bg-amber-900/10 overflow-hidden"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Funding progress"
        >
          <div
            className="h-full bg-amber-500 transition-[width] duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground" aria-live="polite">
        Trading is disabled until your wallet is funded.
      </p>
    </section>
  );
}

function AliveCard({
  arenaAddress,
  balance,
  withdrawDestinationAddress,
  dailySlotsRemaining,
  maxTradesPerDay,
  maxTradeUsdc,
  rules,
  onWithdrawn,
}: {
  arenaAddress: string;
  balance: ArenaBalance;
  withdrawDestinationAddress: string | null;
  dailySlotsRemaining: number;
  maxTradesPerDay: number;
  maxTradeUsdc: number;
  rules: ArenaRules;
  onWithdrawn: () => void;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const addressShort = useMemo(
    () => formatWalletAddress(arenaAddress),
    [arenaAddress],
  );

  const sampleHint = useMemo(() => {
    const tradable = rules.whitelist
      .filter((w) => w.is_tradable)
      .map((w) => w.symbol.toLowerCase());
    const uniq = [...new Set(tradable)];
    const cap = Math.min(maxTradeUsdc, 10);
    const a = uniq[0] ?? "symbol";
    const b = uniq[1] ?? a;
    const c = uniq[2] ?? a;
    return [
      `@commodus buy ${Math.min(5, cap)} usdc of ${a}`,
      `@commodus sell 50% of ${b}`,
      `@commodus status`,
      ...(c !== a
        ? [`@commodus buy ${Math.min(2, cap)} usdc of ${c}`]
        : []),
    ];
  }, [rules.whitelist, maxTradeUsdc]);

  return (
    <section className="rounded-xl border border-green-900/10 bg-green-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-green-800">
          Wallet funded
        </span>
        <span className="text-[11px] text-green-800/70">
          {dailySlotsRemaining}/{maxTradesPerDay} trades left today
        </span>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Arena wallet</h2>
        <button
          type="button"
          onClick={() => copyToClipboard(arenaAddress, setIsCopied)}
          className="text-xs font-mono text-black/70 hover:text-black underline-offset-2 hover:underline"
          aria-label="Copy arena address"
        >
          {isCopied ? "Copied!" : addressShort}
        </button>
      </div>

      <BalanceBlock balance={balance} />

      <WithdrawButton
        balanceUsdc={balance.usdc}
        destinationAddress={withdrawDestinationAddress}
        onWithdrawn={onWithdrawn}
      />

      <div className="rounded-md bg-white/70 border border-green-900/10 p-2">
        <p className="text-[11px] uppercase tracking-wider text-green-900/70 mb-1">
          Cast an order
        </p>
        <ul className="space-y-0.5 text-xs font-mono text-black/80">
          {sampleHint.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/leaderboard"
          className="text-purple-700 font-medium hover:underline"
        >
          Leaderboard
        </Link>
        <Link
          href="/portfolio"
          className="text-purple-700 font-medium hover:underline"
        >
          Portfolio
        </Link>
        <Link href="/rules" className="text-purple-700 font-medium hover:underline">
          Rules
        </Link>
      </div>
    </section>
  );
}

function BalanceBlock({ balance }: { balance: ArenaBalance }) {
  return (
    <div className="rounded-md bg-white/70 border border-green-900/10 p-2 space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wider text-green-900/70">
          Balance
        </span>
        <span className="font-mono text-sm">${balance.usdc.toFixed(2)} USDC</span>
      </div>
      {balance.positions.length > 0 && (
        <ul className="divide-y divide-green-900/10">
          {balance.positions.map((p) => (
            <PositionRow key={p.symbol} position={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PositionRow({ position }: { position: PositionBalance }) {
  return (
    <li className="flex items-baseline justify-between py-1">
      <span className="text-xs font-mono text-black/80">{position.symbol}</span>
      <span className="text-xs font-mono text-black/80">
        {position.quantity.toLocaleString(undefined, {
          maximumFractionDigits: 6,
        })}
        {position.notional_usdc != null && (
          <span className="text-black/60">
            {" "}· ${position.notional_usdc.toFixed(2)}
          </span>
        )}
      </span>
    </li>
  );
}

function RulesCard({ rules }: { rules: ArenaRules }) {
  const tradable = rules.whitelist.filter((a) => a.is_tradable);
  const quoteOnly = rules.whitelist.filter((a) => !a.is_tradable);

  return (
    <SectionCard>
      <h2 className="text-sm font-semibold">Arena rules</h2>
      <ul className="text-xs text-black/80 space-y-1">
        <li>
          Max ${rules.max_trade_usdc} per trade · {rules.max_trades_per_day}{" "}
          trades/day · ${rules.wallet_cap_usdc} wallet cap
        </li>
        <li>
          {(rules.swap_fee_bps / 100).toFixed(1)}% swap fee (min $
          {rules.swap_fee_min_usdc.toFixed(2)}) · gas sponsored by Commodus
        </li>
        <li>
          Commodus operates the arena wallet via Privy; keys are not exposed as a
          seed phrase. Withdraw is out of scope for MVP — contact the operator if
          you need your balance back.
        </li>
      </ul>
      <div>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Tradable vs USDC
        </p>
        <div className="flex flex-wrap gap-1.5">
          {tradable.map((a) => (
            <span
              key={a.symbol}
              className="inline-flex items-center rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-mono"
              title={a.name}
            >
              {a.symbol}
            </span>
          ))}
        </div>
      </div>
      {quoteOnly.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            Quote / routing only
          </p>
          <div className="flex flex-wrap gap-1.5">
            {quoteOnly.map((a) => (
              <span
                key={a.symbol}
                className="inline-flex items-center rounded-full bg-black/[0.03] px-2 py-0.5 text-[11px] font-mono text-black/60"
                title={a.name}
              >
                {a.symbol}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs">
        <Link href="/rules" className="text-purple-700 font-medium hover:underline">
          Full rules →
        </Link>
      </p>
    </SectionCard>
  );
}

function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-black/10 bg-white p-4 space-y-3",
        className,
      )}
    >
      {children}
    </section>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="text-xs text-red-600" role="alert">
      {message}
    </p>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white text-black min-h-screen flex items-center justify-center p-4">
      {children}
    </div>
  );
}
