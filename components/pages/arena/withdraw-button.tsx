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
  onWithdrawn: () => void;
};

export function WithdrawButton({ balanceUsdc, onWithdrawn }: WithdrawButtonProps) {
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
        variant="outline"
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
  result: WithdrawResponse | null;
  errorMessage: string | null;
  isSubmitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

function WithdrawModal({
  balanceUsdc,
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
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-lg space-y-4">
        <header className="space-y-1">
          <h2 id="withdraw-modal-title" className="text-base font-semibold">
            {isSent ? "Withdraw sent" : "Confirm withdraw"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isSent
              ? "Your USDC is on its way. Track it on BaseScan."
              : "This sends your arena balance back to your Farcaster-verified address. Gas is sponsored by Commodus."}
          </p>
        </header>

        {isSent && result ? (
          <SentPanel result={result} />
        ) : (
          <PreviewPanel balanceUsdc={balanceUsdc} />
        )}

        {errorMessage && (
          <p className="text-xs text-red-600" role="alert">
            {errorMessage}
          </p>
        )}

        <div className={cn("flex gap-2", isSent ? "justify-end" : "justify-between")}>
          {isSent ? (
            <Button type="button" onClick={onClose} className="w-full">
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
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

function PreviewPanel({ balanceUsdc }: { balanceUsdc: number }) {
  return (
    <div className="rounded-md border border-black/10 bg-black/[0.02] p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Amount
        </span>
        <span className="font-mono text-sm">${balanceUsdc.toFixed(2)} USDC</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Destination
        </span>
        <span className="text-xs font-mono text-black/80">
          Your verified Farcaster address
        </span>
      </div>
    </div>
  );
}

function SentPanel({ result }: { result: WithdrawResponse }) {
  const sourceLabel =
    result.destination_source === "verification"
      ? "verified Farcaster address"
      : "Farcaster custody address";
  return (
    <div className="rounded-md border border-green-900/10 bg-green-50 p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-green-900/70">
          Sent
        </span>
        <span className="font-mono text-sm text-green-900">
          ${result.amount_usdc.toFixed(2)} USDC
        </span>
      </div>
      <div className="text-xs text-black/70">
        to <span className="font-mono">{formatWalletAddress(result.to)}</span>{" "}
        <span className="text-black/50">({sourceLabel})</span>
      </div>
      <a
        href={`https://basescan.org/tx/${result.tx_hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-mono text-green-900 underline underline-offset-2 break-all"
      >
        View on BaseScan ↗
      </a>
    </div>
  );
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
