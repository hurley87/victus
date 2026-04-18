"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { useEnvironment } from "@/contexts/environment-context";
import { useFarcaster } from "@/contexts/farcaster-context";
import { useUser } from "@/contexts/user-context";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useApiQuery } from "@/hooks/use-api-query";
import type {
  ArenaProfile,
  ArenaRules,
  DesignateArenaAddressRequest,
  DesignateArenaAddressResponse,
} from "@/lib/arena/types";
import { cn, copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/shared/ui/button";
import { Website } from "../website";

/**
 * Arena onboarding page. Defaults the picker to the wallet currently
 * connected to the Mini App so the address the user signs from
 * matches the designated arena address (see #7's `from_address` check).
 */
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
            Sign in to designate your Arena address.
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
  const { data, isLoading, error, refetch } = useApiQuery<ArenaProfile>({
    queryKey: ["arena-me"],
    url: "/api/arena/me",
    isProtected: true,
    retry: false,
  });

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
          <Button variant="outline" onClick={() => refetch()}>
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
            Your designated Farcaster-verified address is where you sign
            trades and receive rewards.
          </p>
        </header>

        {data.is_designated && data.arena_address ? (
          <DesignatedCard
            address={data.arena_address}
            rules={data.rules}
          />
        ) : (
          <DesignatePicker
            verifications={data.verifications}
            onDesignated={() => refetch()}
          />
        )}

        <RulesCard rules={data.rules} />
      </div>
    </div>
  );
}

function DesignatedCard({
  address,
  rules,
}: {
  address: string;
  rules: ArenaRules;
}) {
  const [isCopied, setIsCopied] = useState(false);

  return (
    <section className="rounded-xl border border-black/10 bg-green-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-green-800">
          Arena ready
        </span>
        <span className="text-[11px] text-green-800/70">
          {rules.max_trades_per_day} trades/day · ${rules.max_trade_usdc}
          /trade
        </span>
      </div>
      <p className="text-sm text-black/80">
        You&apos;re trading from
      </p>
      <button
        type="button"
        onClick={() => copyToClipboard(address, setIsCopied)}
        className="font-mono text-sm break-all text-left w-full rounded-md bg-white/60 p-2 border border-green-900/10 hover:bg-white"
        aria-label="Copy arena address"
      >
        {address}
      </button>
      <p className="text-xs text-muted-foreground">
        {isCopied ? "Copied!" : "Tap to copy. Trade from this address in your wallet."}
      </p>
      <SampleCommandHint />
    </section>
  );
}

function DesignatePicker({
  verifications,
  onDesignated,
}: {
  verifications: string[];
  onDesignated: () => void;
}) {
  const { address: connected } = useAccount();
  const connectedLower = connected?.toLowerCase();

  const options = useMemo(
    () =>
      verifications.map((addr) => ({
        address: addr,
        isConnected: connectedLower === addr,
      })),
    [verifications, connectedLower],
  );

  // Default to the currently-connected wallet if it's among the user's
  // verifications, otherwise the first verification.
  const defaultSelection =
    options.find((o) => o.isConnected)?.address ?? options[0]?.address ?? null;

  // `override` is the user's explicit radio choice. We validate it
  // against the current `options` so a stale pick from a previous
  // verification list can't leak through a refetch.
  const [override, setOverride] = useState<string | null>(null);
  const selected =
    options.find((o) => o.address === override)?.address ?? defaultSelection;

  const [formError, setFormError] = useState<string | null>(null);

  const { mutate: designate, isPending } = useApiMutation<
    DesignateArenaAddressResponse,
    DesignateArenaAddressRequest
  >({
    url: "/api/arena/address",
    method: "POST",
    body: (variables) => variables,
    onError: (err) => {
      setFormError(mapDesignateError(err));
      // Stale verifications are the most common cause of 403; refetching
      // /me pulls the latest list for the picker.
      if (/403/.test(err.message)) {
        onDesignated();
      }
    },
    onSuccess: () => {
      setFormError(null);
      onDesignated();
    },
  });

  if (options.length === 0) {
    return <NoVerificationsCard />;
  }

  const handleConfirm = () => {
    if (!selected) return;
    setFormError(null);
    designate({ address: selected });
  };

  if (options.length === 1) {
    const [only] = options;
    return (
      <SectionCard>
        <h2 className="text-sm font-semibold">Designate your Arena address</h2>
        <p className="text-xs text-muted-foreground">
          You have one Farcaster-verified address. Trades will execute from
          this wallet.
        </p>
        <div className="rounded-md border border-black/10 bg-black/5 p-3 font-mono text-sm break-all">
          {only.address}
          {only.isConnected && <ConnectedBadge />}
        </div>
        {formError && <ErrorLine message={formError} />}
        <Button
          className="w-full"
          onClick={handleConfirm}
          disabled={isPending}
        >
          {isPending ? "Confirming…" : "Designate this address"}
        </Button>
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <h2 className="text-sm font-semibold">Pick your Arena address</h2>
      <p className="text-xs text-muted-foreground">
        Commodus will open swaps in your wallet from this address. Pick the
        one you&apos;ll actually sign with — ideally the wallet connected
        to this Mini App.
      </p>
      <ul
        className="space-y-2"
        role="radiogroup"
        aria-label="Verified addresses"
      >
        {options.map((opt) => {
          const isChecked = selected === opt.address;
          return (
            <li key={opt.address}>
              <label
                className={cn(
                  "flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors",
                  isChecked
                    ? "border-black bg-black/5"
                    : "border-black/10 hover:border-black/30",
                )}
              >
                <input
                  type="radio"
                  name="arena-address"
                  value={opt.address}
                  checked={isChecked}
                  onChange={() => setOverride(opt.address)}
                  className="mt-1"
                />
                <span className="flex flex-col gap-1 min-w-0">
                  <span className="font-mono text-sm break-all">
                    {opt.address}
                  </span>
                  {opt.isConnected && <ConnectedBadge />}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {formError && <ErrorLine message={formError} />}
      <Button
        className="w-full"
        onClick={handleConfirm}
        disabled={isPending || !selected}
      >
        {isPending ? "Confirming…" : "Designate selected address"}
      </Button>
    </SectionCard>
  );
}

function NoVerificationsCard() {
  return (
    <SectionCard className="space-y-2">
      <h2 className="text-sm font-semibold">Add a verified address</h2>
      <p className="text-xs text-muted-foreground">
        Commodus trades from a Farcaster-verified address. Add one in your
        Farcaster client (Settings → Verified addresses), then come back
        here to designate it.
      </p>
    </SectionCard>
  );
}

function RulesCard({ rules }: { rules: ArenaRules }) {
  return (
    <SectionCard>
      <h2 className="text-sm font-semibold">Arena rules</h2>
      <ul className="text-xs text-black/80 space-y-1">
        <li>
          Max ${rules.max_trade_usdc} per trade · {rules.max_trades_per_day}{" "}
          trades/day
        </li>
        <li>You sign every swap — Commodus never holds your keys.</li>
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

function SampleCommandHint() {
  return (
    <div className="mt-2 rounded-md bg-white/60 border border-green-900/10 p-2">
      <p className="text-[11px] uppercase tracking-wider text-green-900/70 mb-0.5">
        Try it
      </p>
      <code className="text-xs font-mono text-black/80">
        @commodus buy 5 $WETH
      </code>
    </div>
  );
}

function ConnectedBadge() {
  return (
    <span className="inline-flex self-start items-center rounded-full bg-black text-white text-[10px] px-1.5 py-0.5 uppercase tracking-wide">
      Connected
    </span>
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
// the best we can do client-side is switch on the status code.
function mapDesignateError(err: Error): string {
  const status = Number(err.message.match(/API Error: (\d+)/)?.[1]);
  switch (status) {
    case 400:
      return "That address doesn't look valid.";
    case 401:
      return "Your session expired. Please sign in again.";
    case 403:
      return "That address isn't in your Farcaster verifications. We refreshed the list — try again.";
    case 409:
      return "That address is already designated by another Farcaster account.";
    default:
      return "Couldn't designate that address. Try again.";
  }
}
