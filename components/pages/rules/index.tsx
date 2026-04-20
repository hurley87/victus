"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useEnvironment } from "@/contexts/environment-context";
import { useApiQuery } from "@/hooks/use-api-query";
import type { ArenaRules } from "@/lib/arena/types";
import {
  POINTS_PROFITABLE_CLOSE,
  POINTS_RETURN_10_BONUS,
  POINTS_RETURN_25_BONUS,
  POINTS_TRADE_EXECUTED,
  PROFITABLE_CLOSE_MIN_USDC,
  RETURN_BONUS_10_PCT,
  RETURN_BONUS_25_PCT,
  SCORING_CASTS_PER_UTC_DAY,
} from "@/lib/scoring/constants";
import { Button } from "@/components/shared/ui/button";
import { Website } from "../website";

const RULES_QUERY_KEY = ["arena-rules-public"] as const;

function exampleBuyCommands(rules: ArenaRules): string[] {
  const tradable = rules.whitelist
    .filter((w) => w.is_tradable)
    .map((w) => w.symbol.toLowerCase());
  const uniq = [...new Set(tradable)];
  const cap = Math.min(10, rules.max_trade_usdc);
  const a = uniq[0] ?? "symbol";
  const b = uniq[1] ?? a;
  const c = uniq[2] ?? a;
  const d = uniq[3] ?? a;
  return [
    `@commodus buy ${Math.min(1, cap)} usdc of ${a}`,
    `@commodus buy ${Math.min(5, cap)} usdc of ${b}`,
    `@commodus buy ${cap} usdc of ${c}`,
    ...(d !== c ? [`@commodus buy ${Math.min(2, cap)} usdc of ${d}`] : []),
  ].slice(0, 4);
}

function exampleSellCommands(rules: ArenaRules): string[] {
  const tradable = rules.whitelist
    .filter((w) => w.is_tradable)
    .map((w) => w.symbol.toLowerCase());
  const uniq = [...new Set(tradable)];
  const a = uniq[0] ?? "symbol";
  const b = uniq[1] ?? a;
  const c = uniq[2] ?? a;
  return [
    `@commodus sell 25% of ${a}`,
    `@commodus sell 50% of ${b}`,
    `@commodus sell 100% of ${c}`,
  ];
}

export default function RulesPage() {
  const { isInBrowser } = useEnvironment();

  if (isInBrowser) {
    return <Website />;
  }

  return <RulesContent />;
}

function RulesContent() {
  const { data, isLoading, error, refetch } = useApiQuery<ArenaRules>({
    queryKey: RULES_QUERY_KEY,
    url: "/api/arena/rules",
    retry: false,
  });

  if (isLoading) {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">Loading arena law…</p>
      </Centered>
    );
  }

  if (error || !data) {
    return (
      <Centered>
        <div className="space-y-2 text-center">
          <p className="text-sm text-red-600">Could not load rules.</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      </Centered>
    );
  }

  return <RulesBody rules={data} />;
}

function RulesBody({ rules }: { rules: ArenaRules }) {
  const buys = useMemo(() => exampleBuyCommands(rules), [rules]);
  const sells = useMemo(() => exampleSellCommands(rules), [rules]);
  const feePct = (rules.swap_fee_bps / 100).toFixed(2);

  const tradableRows = rules.whitelist.filter((w) => w.is_tradable);
  const quoteOnlyRows = rules.whitelist.filter((w) => !w.is_tradable);

  return (
    <div className="bg-white text-black min-h-screen flex flex-col items-center p-4 pb-16">
      <div className="w-full max-w-lg space-y-8 pt-8">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Commodus
          </p>
          <h1 className="text-2xl font-semibold">Arena rules</h1>
          <p className="text-sm text-muted-foreground">
            Custodial trading on Base. Commodus executes exactly what thou declarest
            in the cast — no per-trade signature. Cast at{" "}
            <span className="font-mono">@commodus</span>.
          </p>
        </header>

        <section className="rounded-xl border border-black/10 p-4 space-y-3">
          <h2 className="text-sm font-semibold">Commands</h2>
          <p className="text-xs text-muted-foreground">
            The text of thy cast is the law: <span className="font-mono">AMOUNT</span> on
            a buy and <span className="font-mono">PERCENT</span> on a sell are the
            authoritative sizes; Commodus fills those amounts in the arena wallet on
            thy behalf.
          </p>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Buy (USDC in)
            </p>
            <ul className="space-y-1 text-xs font-mono text-black/85">
              {buys.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Sell (percent out)
            </p>
            <ul className="space-y-1 text-xs font-mono text-black/85">
              {sells.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Status
            </p>
            <p className="text-xs font-mono text-black/85">@commodus status</p>
          </div>
        </section>

        <section className="rounded-xl border border-black/10 p-4 space-y-2">
          <h2 className="text-sm font-semibold">Execution</h2>
          <p className="text-xs text-black/80">
            Commodus holds the arena wallet through the configured provider (Privy) and
            signs swaps server-side. Thou fundest USDC once at gladiator mint; thou dost
            not approve each trade in a wallet extension.
          </p>
          <p className="text-xs text-black/80">
            Mint a gladiator with ≥ ${rules.min_mint_deposit_usdc.toFixed(2)} USDC. Trading
            unlocks when thy gladiator is alive.
          </p>
        </section>

        <section className="rounded-xl border border-black/10 p-4 space-y-3">
          <h2 className="text-sm font-semibold">Tradable symbols</h2>
          <p className="text-xs text-muted-foreground">
            Listed assets come from the live server whitelist (same data execution uses).
            Rows below marked “quote / routing” are not opened as new positions against USDC.
          </p>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Tradable vs USDC
            </p>
            <div className="flex flex-wrap gap-1.5">
              {tradableRows.map((a) => (
                <span
                  key={a.symbol}
                  className="inline-flex items-center rounded-full bg-emerald-950/5 px-2 py-0.5 text-[11px] font-mono"
                  title={a.name}
                >
                  {a.symbol}
                </span>
              ))}
            </div>
          </div>
          {quoteOnlyRows.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Quote / routing only
              </p>
              <div className="flex flex-wrap gap-1.5">
                {quoteOnlyRows.map((a) => (
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
          )}
        </section>

        <section className="rounded-xl border border-black/10 p-4 space-y-2">
          <h2 className="text-sm font-semibold">Limits</h2>
          <ul className="text-xs text-black/80 space-y-1 list-disc pl-4">
            <li>
              Daily trade cap: {rules.max_trades_per_day} completed trades per UTC day
              (from <span className="font-mono">max_trades_per_day</span>).
            </li>
            <li>
              Per-trade cap: ${rules.max_trade_usdc} USDC notional on buys (
              <span className="font-mono">max_trade_usdc</span>).
            </li>
            <li>
              Wallet cap: ${rules.wallet_cap_usdc} USDC total custodied value including
              live USDC and marked-to-market holdings (
              <span className="font-mono">wallet_cap_usdc</span>).
            </li>
            <li>
              Minimum mint deposit: ${rules.min_mint_deposit_usdc.toFixed(2)} USDC (
              <span className="font-mono">min_mint_deposit_usdc</span>).
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-black/10 p-4 space-y-2">
          <h2 className="text-sm font-semibold">Economics</h2>
          <ul className="text-xs text-black/80 space-y-1 list-disc pl-4">
            <li>
              Fee-on-swap: {feePct}% of notional, minimum $
              {rules.swap_fee_min_usdc.toFixed(2)} (
              <span className="font-mono">swap_fee_bps</span> /{" "}
              <span className="font-mono">swap_fee_min_usdc</span>).
            </li>
            <li>
              Gas: Commodus sponsors all gas. Thou dost not need ETH in the arena wallet.
            </li>
            <li>
              Cost basis and realized PnL are computed net of the swap fee and sponsored
              gas, so leaderboard rank reflects economic performance after those costs.
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-black/10 p-4 space-y-2">
          <h2 className="text-sm font-semibold">Custody</h2>
          <p className="text-xs text-black/80">
            Commodus operates the arena wallet on thy behalf via the configured wallet
            provider. Keys are not exposed as a seed phrase for thee to hold.
          </p>
          <p className="text-xs text-black/80">
            Withdraw is out of scope for MVP. Contact the operator if thou needest thy
            balance returned.
          </p>
        </section>

        <section className="rounded-xl border border-black/10 p-4 space-y-3">
          <h2 className="text-sm font-semibold">Scoring</h2>
          <p className="text-xs text-muted-foreground">
            Points are for leaderboard rank only. At most{" "}
            {SCORING_CASTS_PER_UTC_DAY} executed casts per UTC day earn scoring
            weight; the table resteth each calendar month (UTC).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-black/10 text-left">
                  <th className="py-1 pr-2 font-semibold">Event</th>
                  <th className="py-1 font-semibold">Points</th>
                </tr>
              </thead>
              <tbody className="text-black/85">
                <tr className="border-b border-black/5">
                  <td className="py-1 pr-2">Executed trade (counts toward daily slot)</td>
                  <td className="font-mono">+{POINTS_TRADE_EXECUTED}</td>
                </tr>
                <tr className="border-b border-black/5">
                  <td className="py-1 pr-2">
                    Profitable close ({">="}
                    ${PROFITABLE_CLOSE_MIN_USDC.toFixed(2)} realized PnL after fees)
                  </td>
                  <td className="font-mono">+{POINTS_PROFITABLE_CLOSE}</td>
                </tr>
                <tr className="border-b border-black/5">
                  <td className="py-1 pr-2">Return bonus — ≥ {RETURN_BONUS_10_PCT}%</td>
                  <td className="font-mono">+{POINTS_RETURN_10_BONUS}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-2">Return bonus — ≥ {RETURN_BONUS_25_PCT}%</td>
                  <td className="font-mono">+{POINTS_RETURN_25_BONUS}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-black/80">
            The profitable-close bonus only applies when realized PnL on the sell is at
            least ${PROFITABLE_CLOSE_MIN_USDC.toFixed(2)} after fees — dust wins do not
            count.
          </p>
        </section>

        <Link
          href="/arena"
          className="inline-block text-sm text-purple-700 font-medium hover:underline"
        >
          ← Back to Arena
        </Link>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white text-black min-h-screen flex items-center justify-center p-4">
      {children}
    </div>
  );
}
