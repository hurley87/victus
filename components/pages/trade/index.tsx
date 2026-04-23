"use client";

import { useMemo } from "react";
import { ScoringTable } from "@/components/shared/ui/scoring-table";
import { Button } from "@/components/shared/ui/button";
import { useApiQuery } from "@/hooks/use-api-query";
import type { ArenaRules } from "@/lib/arena/types";

function tradableSymbolsLower(rules: ArenaRules): string[] {
  const lower = rules.whitelist
    .filter((w) => w.is_tradable)
    .map((w) => w.symbol.toLowerCase());
  return [...new Set(lower)];
}

function exampleBuyCommands(rules: ArenaRules): string[] {
  const uniq = tradableSymbolsLower(rules);
  const cap = Math.min(10, rules.max_trade_usdc);
  const a = uniq[0] ?? "symbol";
  const b = uniq[1] ?? a;
  const c = uniq[2] ?? a;
  return [
    `commodus buy ${Math.min(3, cap)} usdc of ${a}`,
    `commodus buy ${Math.min(5, cap)} usdc of ${b}`,
    `commodus buy ${Math.min(10, cap)} usdc of ${c}`,
  ];
}

function exampleSellCommands(rules: ArenaRules): string[] {
  const uniq = tradableSymbolsLower(rules);
  const a = uniq[0] ?? "symbol";
  const b = uniq[1] ?? a;
  return [
    `commodus sell 25% of ${a}`,
    `commodus sell 50% of ${b}`,
  ];
}

export default function TradePage() {
  const { data, isLoading, error, refetch } = useApiQuery<ArenaRules>({
    queryKey: ["arena-rules-public"],
    url: "/api/arena/rules",
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
          {error?.message ?? "Could not load trade rules."}
        </p>
        <Button variant="imperial-outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return <TradeContent rules={data} />;
}

function TradeContent({ rules }: { rules: ArenaRules }) {
  const buys = useMemo(() => exampleBuyCommands(rules), [rules]);
  const sells = useMemo(() => exampleSellCommands(rules), [rules]);

  const feePct = (rules.swap_fee_bps / 100).toFixed(2);
  const tradableTokens = rules.whitelist.filter((w) => w.is_tradable);

  return (
    <div className="text-white space-y-6 pt-4">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="font-serif text-2xl uppercase tracking-wider text-gold">
            Trade with Commodus
          </h1>
          <p className="text-xs text-zinc-400">
            Cast a command at @commodus and Commodus executes valid trades
            publicly.
          </p>
        </header>

        {/* Tradable tokens */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gold">
            Tradable Tokens
          </h2>
          <p className="text-xs text-zinc-400">
            All trades are made with USDC
          </p>
          <div className="flex flex-wrap gap-2">
            {tradableTokens.map((token) => (
              <span
                key={token.symbol}
                className="rounded-full border border-gold/40 px-3 py-1 text-xs font-semibold text-gold"
                title={token.name}
              >
                {token.symbol}
              </span>
            ))}
          </div>
        </section>

        {/* Example commands */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gold">
            Commands
          </h2>

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">
              Buy
            </p>
            <div className="space-y-1.5">
              {buys.map((cmd) => (
                <CommandPill key={cmd} command={cmd} />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">
              Sell
            </p>
            <div className="space-y-1.5">
              {sells.map((cmd) => (
                <CommandPill key={cmd} command={cmd} />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">
              Status
            </p>
            <CommandPill command="commodus status" />
          </div>
        </section>

        {/* Scoring */}
        <ScoringTable />

        {/* Economics and Custody */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gold">
            Economics and Custody
          </h2>

          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                Fees and gas
              </p>
              <p className="text-sm text-zinc-300">
                {feePct}% swap fee, minimum ${rules.swap_fee_min_usdc.toFixed(2)}{" "}
                USDC. Gas is sponsored — no ETH required in your arena wallet.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                Custody
              </p>
              <p className="text-sm text-zinc-300">
                Your arena wallet is custodied via Privy. Commodus signs trades
                server-side on your behalf — no per-trade wallet approval
                required.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                Withdrawals
              </p>
              <p className="text-sm text-zinc-300">
                Withdrawals are processed by the operator. Contact the operator
                if you need your balance returned.
              </p>
            </div>
          </div>
        </section>

        {/* Trade limits grid */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gold">
            Trade Restrictions
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <LimitCell
              label="Daily Cap"
              value={`${rules.max_trades_per_day} trades`}
            />
            <LimitCell
              label="Trade Size"
              value={`$${rules.max_trade_usdc}`}
            />
            <LimitCell
              label="Wallet Cap"
              value={`$${rules.wallet_cap_usdc}`}
            />
            <LimitCell
              label="Min Deposit"
              value={`$${rules.min_mint_deposit_usdc.toFixed(2)}`}
            />
          </div>
        </section>
    </div>
  );
}

function CommandPill({ command }: { command: string }) {
  return (
    <div className="rounded-lg border border-gold/30 bg-imperial-surface px-3 py-2 text-sm font-mono text-zinc-200">
      @{command}
    </div>
  );
}

function LimitCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-imperial-surface border border-imperial-border p-3 space-y-1">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="text-white text-lg font-semibold font-mono">{value}</p>
    </div>
  );
}
