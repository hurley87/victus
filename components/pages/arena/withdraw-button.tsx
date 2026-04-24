"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/shared/ui/button";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { ApiError } from "@/lib/api-error";
import type { WithdrawRequest, WithdrawResponse } from "@/lib/arena/types";
import { cn, formatWalletAddress } from "@/lib/utils";

/**
 * Confirm-then-submit withdraw button. The confirm step is load-bearing,
 * not cosmetic — the underlying Privy `eth_sendTransaction` is not
 * idempotent at the user's intent layer, so "click = fire" would let a
 * misclick move real money.
 */

type WithdrawButtonProps = {
  balanceUsdc: number;
  destinationAddress: string | null;
  onWithdrawn: () => void;
};

export function WithdrawButton({
  balanceUsdc,
  destinationAddress,
  onWithdrawn,
}: WithdrawButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [result, setResult] = useState<WithdrawResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { mutate: submit, isPending: isSubmitting, reset } = useApiMutation<
    WithdrawResponse,
    WithdrawRequest
  >({
    url: "/api/arena/withdraw",
    method: "POST",
    body: () => ({}),
    onSuccess: (data) => setResult(data),
    onError: (err) => setErrorMessage(mapWithdrawError(err)),
  });

  const open = useCallback(() => {
    setResult(null);
    setErrorMessage(null);
    reset();
    setIsOpen(true);
  }, [reset]);

  const close = useCallback(() => {
    // Closing after a successful withdraw is the user's signal to
    // refresh the arena view — the parent's refetch flips the balance
    // to 0 and re-enables the button for another run.
    const wasSent = result !== null;
    setIsOpen(false);
    setResult(null);
    setErrorMessage(null);
    reset();
    if (wasSent) onWithdrawn();
  }, [result, reset, onWithdrawn]);

  const handleConfirm = useCallback(() => {
    setErrorMessage(null);
    submit({});
  }, [submit]);

  return (
    <>
      <Button
        type="button"
        variant="imperial-outline"
        className="w-full"
        onClick={open}
        disabled={balanceUsdc <= 0}
        aria-label="Withdraw USDC"
      >
        Withdraw
      </Button>

      {isOpen && (
        <WithdrawModal
          balanceUsdc={balanceUsdc}
          destinationAddress={destinationAddress}
          result={result}
          errorMessage={errorMessage}
          isSubmitting={isSubmitting}
          onConfirm={handleConfirm}
          onClose={close}
        />
      )}
    </>
  );
}

type WithdrawModalProps = {
  balanceUsdc: number;
  destinationAddress: string | null;
  result: WithdrawResponse | null;
  errorMessage: string | null;
  isSubmitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

function WithdrawModal({
  balanceUsdc,
  destinationAddress,
  result,
  errorMessage,
  isSubmitting,
  onConfirm,
  onClose,
}: WithdrawModalProps) {
  const isSent = result !== null;

  // Esc closes unless mid-submit — closing doesn't cancel the tx, and
  // we don't want the UI to suggest otherwise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSubmitting, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-imperial-surface border border-imperial-border p-4 shadow-lg space-y-4">
        <header className="space-y-1">
          <h2 id="withdraw-modal-title" className="text-base font-semibold text-white">
            {isSent ? "Withdraw sent" : "Confirm withdraw"}
          </h2>
          <p className="text-xs text-zinc-400">
            {isSent
              ? "Your USDC is on its way. Track it on BaseScan."
              : "This sends your arena balance back to your Farcaster-verified address. Gas is sponsored by Commodus."}
          </p>
        </header>

        {isSent && result ? (
          <SentPanel result={result} />
        ) : (
          <PreviewPanel
            balanceUsdc={balanceUsdc}
            destinationAddress={destinationAddress}
          />
        )}

        {errorMessage && (
          <p className="text-xs text-red-400" role="alert">
            {errorMessage}
          </p>
        )}

        <div className={cn("flex gap-2", isSent ? "justify-end" : "justify-between")}>
          {isSent ? (
            <Button type="button" variant="imperial" onClick={onClose} className="w-full">
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 text-zinc-400"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="imperial"
                onClick={onConfirm}
                disabled={isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? "Sending…" : `Withdraw $${balanceUsdc.toFixed(2)}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({
  balanceUsdc,
  destinationAddress,
}: {
  balanceUsdc: number;
  destinationAddress: string | null;
}) {
  return (
    <div className="rounded-md border border-imperial-border bg-imperial-bg p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          Amount
        </span>
        <span className="font-mono text-sm text-zinc-200">${balanceUsdc.toFixed(2)} USDC</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          Destination
        </span>
        <span
          className={cn(
            "max-w-[13rem] break-all text-right text-xs font-mono sm:max-w-[16rem]",
            destinationAddress ? "text-zinc-200" : "text-zinc-500",
          )}
        >
          {destinationAddress ?? "No verified wallet found"}
        </span>
      </div>
    </div>
  );
}

function SentPanel({ result }: { result: WithdrawResponse }) {
  const sourceLabel = destinationSourceLabel(result.destination_source);
  return (
    <div className="rounded-md border border-pnl-positive/20 bg-pnl-positive/5 p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-pnl-positive/70">
          Sent
        </span>
        <span className="font-mono text-sm text-pnl-positive">
          ${result.amount_usdc.toFixed(2)} USDC
        </span>
      </div>
      <div className="text-xs text-zinc-400">
        to <span className="font-mono">{formatWalletAddress(result.to)}</span>{" "}
        <span className="text-zinc-500">({sourceLabel})</span>
      </div>
      <a
        href={`https://basescan.org/tx/${result.tx_hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-mono text-pnl-positive underline underline-offset-2 break-all"
      >
        View on BaseScan ↗
      </a>
    </div>
  );
}

function destinationSourceLabel(source: WithdrawResponse["destination_source"]): string {
  switch (source) {
    case "funding_wallet":
      return "funding wallet";
    case "verification":
      return "verified Farcaster address";
    case "custody":
      return "Farcaster custody address";
  }
}

function mapWithdrawError(err: Error): string {
  const status = err instanceof ApiError ? err.status : 0;
  switch (status) {
    case 401:
      return "Your session expired. Please sign in again.";
    case 403:
      return "No Farcaster-verified address to withdraw to. Add one to your Farcaster profile.";
    case 404:
      return "No arena wallet found. Mint your gladiator first.";
    case 409:
      return "Withdraw blocked — another withdraw may still be in flight, or your gladiator isn't alive yet.";
    case 503:
      return "Withdraw is temporarily unavailable. Try again shortly.";
    default:
      return "Couldn't send the withdraw. Try again in a moment.";
  }
}
