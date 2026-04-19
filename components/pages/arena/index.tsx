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
  GladiatorSummary,
  MintGladiatorRequest,
  MintGladiatorResponse,
  PositionBalance,
} from "@/lib/arena/types";
import { cn, copyToClipboard, formatWalletAddress } from "@/lib/utils";
import { Button } from "@/components/shared/ui/button";
import { DepositButton } from "./deposit-button";
import { Website } from "../website";

/**
 * Arena onboarding page. Three states driven by `GET /api/arena/me`:
 *
 *   - no gladiator yet  → mint button (auto-derived name)
 *   - pending funding   → in-app deposit button + live progress meter
 *   - alive             → trading UI with live balance + rules + slots
 *
 * The page polls `/api/arena/me` while `needs_funding` is true so the
 * server-side self-heal (`getArenaProfile` flips pending_funding → alive
 * when on-chain USDC clears the threshold) surfaces within ~5s of the
 * server's RPC seeing the deposit.
 */

const ARENA_QUERY_KEY = ["arena-me"] as const;

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
            Mint your gladiator. Fund the arena wallet. Trade by casting at
            <span className="font-mono"> @commodus</span>.
          </p>
        </header>

        {renderState(data, refetchArena)}

        <RulesCard rules={data.rules} />
      </div>
    </div>
  );
}

function renderState(profile: ArenaProfile, onChange: () => void) {
  if (!profile.gladiator) {
    return (
      <PreMintCard
        suggestedName={profile.suggested_name ?? "gladiator"}
        onMinted={onChange}
      />
    );
  }
  if (profile.needs_funding && profile.arena_address) {
    return (
      <PendingFundingCard
        gladiator={profile.gladiator}
        arenaAddress={profile.arena_address}
        balance={profile.balance}
        minDepositUsdc={profile.rules.min_mint_deposit_usdc}
        onFundingConfirmed={onChange}
      />
    );
  }
  if (profile.arena_address) {
    return (
      <AliveCard
        gladiator={profile.gladiator}
        arenaAddress={profile.arena_address}
        balance={profile.balance}
        dailySlotsRemaining={profile.daily_slots_remaining}
        maxTradesPerDay={profile.rules.max_trades_per_day}
        maxTradeUsdc={profile.rules.max_trade_usdc}
      />
    );
  }
  return null;
}

function PreMintCard({
  suggestedName,
  onMinted,
}: {
  suggestedName: string;
  onMinted: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  // Empty body — server derives the name from the session's Farcaster
  // username. Kept typed as MintGladiatorRequest so the hook's generics
  // still line up if we reintroduce a custom-name surface later.
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
    <SectionCard>
      <h2 className="text-sm font-semibold">Enter the Arena</h2>
      <p className="text-xs text-muted-foreground">
        Commodus will mint a gladiator under your Farcaster handle and
        provision a custodial arena wallet on Base. Fund it with $5 USDC
        to start trading by casting at <span className="font-mono">@commodus</span>.
      </p>

      <div className="rounded-md border border-black/10 bg-black/[0.02] p-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Gladiator name
        </p>
        <p className="font-mono text-sm break-all">{suggestedName}</p>
      </div>

      {formError && <ErrorLine message={formError} />}

      <Button
        type="button"
        className="w-full"
        onClick={() => {
          setFormError(null);
          mint({});
        }}
        disabled={isPending}
      >
        {isPending ? "Minting…" : "Mint gladiator"}
      </Button>
    </SectionCard>
  );
}

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
    <section className="rounded-xl border border-amber-900/10 bg-amber-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">
          Pending funding
        </span>
        <span className="text-[11px] text-amber-800/70 font-mono">
          {gladiator.name}
        </span>
      </div>

      <p className="text-sm text-black/80">
        Fund your gladiator with ≥ ${minDepositUsdc.toFixed(2)} USDC on
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
        Trading is disabled until your gladiator is alive.
      </p>
    </section>
  );
}

function AliveCard({
  gladiator,
  arenaAddress,
  balance,
  dailySlotsRemaining,
  maxTradesPerDay,
  maxTradeUsdc,
}: {
  gladiator: GladiatorSummary;
  arenaAddress: string;
  balance: ArenaBalance;
  dailySlotsRemaining: number;
  maxTradesPerDay: number;
  maxTradeUsdc: number;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const addressShort = useMemo(
    () => formatWalletAddress(arenaAddress),
    [arenaAddress],
  );

  return (
    <section className="rounded-xl border border-green-900/10 bg-green-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-green-800">
          Gladiator alive
        </span>
        <span className="text-[11px] text-green-800/70">
          {dailySlotsRemaining}/{maxTradesPerDay} trades left today
        </span>
      </div>

      <div>
        <h2 className="text-lg font-semibold">{gladiator.name}</h2>
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

      <div className="rounded-md bg-white/70 border border-green-900/10 p-2">
        <p className="text-[11px] uppercase tracking-wider text-green-900/70 mb-1">
          Decree a trade
        </p>
        <ul className="space-y-0.5 text-xs font-mono text-black/80">
          <li>@commodus buy {Math.min(10, maxTradeUsdc)} usdc of aero</li>
          <li>@commodus sell 50% of aero</li>
          <li>@commodus status</li>
        </ul>
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
  return (
    <SectionCard>
      <h2 className="text-sm font-semibold">Arena rules</h2>
      <ul className="text-xs text-black/80 space-y-1">
        <li>
          Max ${rules.max_trade_usdc} per trade · {rules.max_trades_per_day}{" "}
          trades/day · ${rules.wallet_cap_usdc} wallet cap
        </li>
        <li>
          {(rules.swap_fee_bps / 100).toFixed(1)}% swap fee
          {" "}(min ${rules.swap_fee_min_usdc.toFixed(2)}) · gas sponsored
        </li>
        <li>
          Commodus custodies the arena wallet via Privy (TEE-backed).
          Withdrawals are operator-mediated in MVP.
        </li>
      </ul>
      <div>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Tradable
        </p>
        <div className="flex flex-wrap gap-1.5">
          {rules.whitelist.map((a) => (
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

// `useApiMutation` only surfaces `API Error: <status>` with no body, so
// we switch on the status code to pick user-facing copy. With the
// auto-derived-name flow, 400/409 are effectively unreachable (Farcaster
// usernames are globally unique and the `gladiator-{fid}` fallback is
// too) — kept as defensive fallbacks in case an admin surface later
// reintroduces an explicit-name path.
function mapMintError(err: Error): string {
  const status = Number(err.message.match(/API Error: (\d+)/)?.[1]);
  switch (status) {
    case 401:
      return "Your session expired. Please sign in again.";
    case 503:
      return "Arena wallet provisioning is down. Try again shortly.";
    default:
      return "Couldn't mint your gladiator. Try again.";
  }
}
