"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { sdk } from "@farcaster/miniapp-sdk";
import { Send } from "lucide-react";
import { Button } from "@/components/shared/ui/button";
import { useFarcaster } from "@/contexts/farcaster-context";
import { useApiQuery } from "@/hooks/use-api-query";
import type { ArenaRules, WhitelistEntry } from "@/lib/arena/types";
import { COMMAND_BOT_FID, COMMAND_BOT_HANDLE } from "@/lib/commodus/bot";
import { cn } from "@/lib/utils";

const DEFAULT_BUY_PRESETS = [2, 4, 6, 10];
const SELL_PRESETS = [25, 50, 100];

type TradeMode = "buy" | "sell";

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
    `buy ${Math.min(2, cap)} usdc of ${a}`,
    `buy ${Math.min(5, cap)} usdc of ${b}`,
    `buy ${Math.min(10, cap)} usdc of ${c}`,
  ];
}

function exampleSellCommands(rules: ArenaRules): string[] {
  const uniq = tradableSymbolsLower(rules);
  const a = uniq[0] ?? "symbol";
  const b = uniq[1] ?? a;
  return [
    `sell 25% of ${a}`,
    `sell 50% of ${b}`,
  ];
}

function buyPresets(maxTradeUsdc: number): number[] {
  const bounded = DEFAULT_BUY_PRESETS.map((amount) =>
    Math.min(amount, maxTradeUsdc),
  );
  return [...new Set(bounded)].filter((amount) => amount > 0);
}

function formatNumberInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function buyAmountErrorMessage(
  parsed: number,
  maxUsdc: number,
): string | null {
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "Enter a buy amount above 0 USDC.";
  }
  if (parsed > maxUsdc) {
    return `Max buy is ${maxUsdc} USDC.`;
  }
  return null;
}

function sellPercentErrorMessage(parsed: number): string | null {
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed > 100
  ) {
    return "Sell percent must be between 1 and 100.";
  }
  return null;
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
  const tradableTokens = useMemo(
    () => rules.whitelist.filter((w) => w.is_tradable),
    [rules.whitelist],
  );
  const buyAmountPresets = useMemo(
    () => buyPresets(rules.max_trade_usdc),
    [rules.max_trade_usdc],
  );
  const searchParams = useSearchParams();
  const tradableSymbols = useMemo(
    () => tradableSymbolsLower(rules),
    [rules],
  );

  const urlTokenRaw = searchParams.get("token")?.trim().toLowerCase() ?? null;
  const urlToken =
    urlTokenRaw && tradableSymbols.includes(urlTokenRaw) ? urlTokenRaw : null;
  const urlAmountRaw = Number(searchParams.get("amount"));
  const urlAmount =
    Number.isFinite(urlAmountRaw) &&
    urlAmountRaw > 0 &&
    urlAmountRaw <= rules.max_trade_usdc
      ? urlAmountRaw
      : null;
  const urlModeRaw = searchParams.get("mode");
  const urlMode: TradeMode | null =
    urlModeRaw === "buy" || urlModeRaw === "sell" ? urlModeRaw : null;

  const initialBuyAmount = formatNumberInput(
    urlAmount ??
      buyAmountPresets[0] ??
      rules.max_trade_usdc,
  );
  const initialToken =
    urlToken ?? tradableTokens[0]?.symbol.toLowerCase() ?? "symbol";
  const initialMode: TradeMode = urlMode ?? "buy";
  const { capabilities } = useFarcaster();
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [mode, setMode] = useState<TradeMode>(initialMode);
  const [selectedSymbol, setSelectedSymbol] = useState(initialToken);
  const [buyAmount, setBuyAmount] = useState(initialBuyAmount);
  const [sellPercent, setSellPercent] = useState("50");

  const feePct = (rules.swap_fee_bps / 100).toFixed(2);
  const canComposeCast = capabilities?.includes("actions.composeCast") ?? true;
  const parsedBuyAmount = Number(buyAmount);
  const parsedSellPercent = Number(sellPercent);
  const buyAmountError = buyAmountErrorMessage(
    parsedBuyAmount,
    rules.max_trade_usdc,
  );
  const sellPercentError = sellPercentErrorMessage(parsedSellPercent);
  const command =
    mode === "buy"
      ? `buy ${buyAmount || "0"} usdc of ${selectedSymbol}`
      : `sell ${sellPercent || "0"}% of ${selectedSymbol}`;
  const commandError = mode === "buy" ? buyAmountError : sellPercentError;
  const isComposeDisabled =
    !canComposeCast || pendingCommand !== null || commandError !== null;
  const isAnyComposeDisabled = !canComposeCast || pendingCommand !== null;

  async function composeCommand(command: string) {
    const text = `${COMMAND_BOT_HANDLE} ${command}`;

    setPendingCommand(command);
    setComposeError(null);

    try {
      await sdk.actions.composeCast({ text });
    } catch (err) {
      console.error("Failed to open Farcaster cast composer", err);
      setComposeError("Could not open the Farcaster cast composer.");
    } finally {
      setPendingCommand(null);
    }
  }

  return (
    <div className="text-white space-y-6 pt-4">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl uppercase tracking-wider text-gold">
          Trade with Commodus
        </h1>
        <p className="text-xs text-zinc-400">
          Cast a command at {COMMAND_BOT_HANDLE} and Commodus executes valid
          trades publicly.
        </p>
      </header>

      <CommandComposer
        mode={mode}
        setMode={setMode}
        tokens={tradableTokens}
        selectedSymbol={selectedSymbol}
        setSelectedSymbol={setSelectedSymbol}
        buyAmount={buyAmount}
        setBuyAmount={setBuyAmount}
        buyAmountPresets={buyAmountPresets}
        sellPercent={sellPercent}
        setSellPercent={setSellPercent}
        command={command}
        commandError={commandError}
        disabled={isComposeDisabled}
        isPending={pendingCommand === command}
        onCompose={composeCommand}
        maxTradeUsdc={rules.max_trade_usdc}
      />

      {!canComposeCast ? (
        <p className="text-xs text-pnl-negative">
          This Farcaster client cannot open the cast composer.
        </p>
      ) : null}

      {composeError ? (
        <p className="text-xs text-pnl-negative">{composeError}</p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gold">
          Quick Casts
        </h2>

        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">
            Buy
          </p>
          <div className="space-y-1.5">
            {buys.map((cmd) => (
              <CommandButton
                key={cmd}
                command={cmd}
                disabled={isAnyComposeDisabled}
                isPending={pendingCommand === cmd}
                onCompose={composeCommand}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">
            Sell
          </p>
          <div className="space-y-1.5">
            {sells.map((cmd) => (
              <CommandButton
                key={cmd}
                command={cmd}
                disabled={isAnyComposeDisabled}
                isPending={pendingCommand === cmd}
                onCompose={composeCommand}
              />
            ))}
          </div>
        </div>

      </section>

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
            value={`$${rules.min_funding_deposit_usdc.toFixed(2)}`}
          />
        </div>
      </section>
    </div>
  );
}

function CommandComposer({
  mode,
  setMode,
  tokens,
  selectedSymbol,
  setSelectedSymbol,
  buyAmount,
  setBuyAmount,
  buyAmountPresets,
  sellPercent,
  setSellPercent,
  command,
  commandError,
  disabled,
  isPending,
  onCompose,
  maxTradeUsdc,
}: {
  mode: TradeMode;
  setMode: (mode: TradeMode) => void;
  tokens: WhitelistEntry[];
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;
  buyAmount: string;
  setBuyAmount: (amount: string) => void;
  buyAmountPresets: number[];
  sellPercent: string;
  setSellPercent: (percent: string) => void;
  command: string;
  commandError: string | null;
  disabled: boolean;
  isPending: boolean;
  onCompose: (command: string) => Promise<void>;
  maxTradeUsdc: number;
}) {
  const castText = `${COMMAND_BOT_HANDLE} ${command}`;

  return (
    <section className="rounded-xl border border-gold/30 bg-imperial-surface p-3 shadow-[0_18px_40px_rgba(0,0,0,0.28)] space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-imperial-border bg-black/25 p-1">
        <ModeButton
          label="Buy"
          sublabel="USDC in"
          isActive={mode === "buy"}
          onClick={() => setMode("buy")}
        />
        <ModeButton
          label="Sell"
          sublabel="Position out"
          isActive={mode === "sell"}
          onClick={() => setMode("sell")}
        />
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Token
        </p>
        <div className="grid grid-cols-2 gap-2">
          {tokens.map((token) => {
            const symbol = token.symbol.toLowerCase();
            const isActive = selectedSymbol === symbol;

            return (
              <button
                type="button"
                key={token.symbol}
                onClick={() => setSelectedSymbol(symbol)}
                className={cn(
                  "min-h-14 rounded-lg border px-3 py-2 text-left transition",
                  isActive
                    ? "border-gold bg-gold text-imperial-bg shadow-[0_0_22px_rgba(216,184,106,0.22)]"
                    : "border-imperial-border bg-black/20 text-zinc-200 hover:border-gold/60",
                )}
              >
                <span className="block font-mono text-base font-semibold uppercase">
                  {token.symbol}
                </span>
                <span className="block truncate text-[11px] opacity-75">
                  {token.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {mode === "buy" ? (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Buy Amount
              </p>
              <p className="text-xs text-zinc-500">Max {maxTradeUsdc} USDC</p>
            </div>
            <label className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <input
                type="number"
                min="0"
                max={maxTradeUsdc}
                step="0.01"
                inputMode="decimal"
                value={buyAmount}
                onChange={(event) => setBuyAmount(event.target.value)}
                className="h-12 w-full max-w-[150px] rounded-lg border border-gold/40 bg-black/30 px-3 text-right font-mono text-lg font-semibold text-white outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/30"
                aria-label="Buy amount in USDC"
              />
              <span className="font-mono text-sm text-zinc-400">USDC</span>
            </label>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {buyAmountPresets.map((amount) => (
              <PresetButton
                key={amount}
                label={`$${formatNumberInput(amount)}`}
                isActive={buyAmount === formatNumberInput(amount)}
                onClick={() => setBuyAmount(formatNumberInput(amount))}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Sell Amount
              </p>
              <p className="text-xs text-zinc-500">Percent of position</p>
            </div>
            <label className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                inputMode="numeric"
                value={sellPercent}
                onChange={(event) => setSellPercent(event.target.value)}
                className="h-12 w-full max-w-[120px] rounded-lg border border-gold/40 bg-black/30 px-3 text-right font-mono text-lg font-semibold text-white outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/30"
                aria-label="Sell percent"
              />
              <span className="font-mono text-sm text-zinc-400">%</span>
            </label>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={Number(sellPercent) || 1}
            onChange={(event) => setSellPercent(event.target.value)}
            className="w-full accent-gold"
            aria-label="Sell percent slider"
          />
          <div className="grid grid-cols-3 gap-2">
            {SELL_PRESETS.map((percent) => (
              <PresetButton
                key={percent}
                label={`${percent}%`}
                isActive={sellPercent === String(percent)}
                onClick={() => setSellPercent(String(percent))}
              />
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gold/30 bg-black/25 p-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Cast Preview
        </p>
        <p className="break-words font-mono text-sm text-zinc-100">
          {castText}
        </p>
      </div>

      {commandError ? (
        <p className="text-xs text-pnl-negative">{commandError}</p>
      ) : null}

      <Button
        type="button"
        variant="imperial"
        size="lg"
        className="min-h-14 w-full rounded-lg text-base"
        disabled={disabled}
        aria-label={`Compose cast to ${COMMAND_BOT_HANDLE} FID ${COMMAND_BOT_FID}: ${castText}`}
        onClick={() => void onCompose(command)}
      >
        {isPending ? (
          <span className="size-5 animate-spin rounded-full border-2 border-imperial-bg border-t-transparent" />
        ) : (
          <Send className="size-5" aria-hidden="true" />
        )}
        Cast Command
      </Button>
    </section>
  );
}

function ModeButton({
  label,
  sublabel,
  isActive,
  onClick,
}: {
  label: string;
  sublabel: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-14 rounded-md px-3 py-2 text-left transition",
        isActive
          ? "bg-gold text-imperial-bg"
          : "text-zinc-300 hover:bg-white/5 hover:text-white",
      )}
      aria-pressed={isActive}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span className="block text-[11px] opacity-75">{sublabel}</span>
    </button>
  );
}

function PresetButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-lg border px-2 font-mono text-sm font-semibold transition",
        isActive
          ? "border-gold bg-gold text-imperial-bg"
          : "border-imperial-border bg-black/20 text-zinc-200 hover:border-gold/60 hover:text-gold",
      )}
      aria-pressed={isActive}
    >
      {label}
    </button>
  );
}

function CommandButton({
  command,
  disabled,
  isPending,
  onCompose,
}: {
  command: string;
  disabled: boolean;
  isPending: boolean;
  onCompose: (command: string) => Promise<void>;
}) {
  const castText = `${COMMAND_BOT_HANDLE} ${command}`;

  return (
    <Button
      type="button"
      variant="imperial-outline"
      className="min-h-14 w-full justify-between whitespace-normal rounded-lg border-gold/40 bg-imperial-surface px-4 py-3 text-left font-mono text-sm text-zinc-200 hover:bg-gold/10 hover:text-gold"
      disabled={disabled || isPending}
      aria-label={`Compose cast to ${COMMAND_BOT_HANDLE} FID ${COMMAND_BOT_FID}: ${castText}`}
      onClick={() => void onCompose(command)}
    >
      <span className="min-w-0 flex-1 break-words">{castText}</span>
      {isPending ? (
        <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      ) : (
        <Send className="size-4 shrink-0" aria-hidden="true" />
      )}
    </Button>
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
