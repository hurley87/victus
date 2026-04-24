"use client";

import { useEffect, useRef, useState } from "react";
import { erc20Abi, getAddress, parseUnits, type Address } from "viem";
import { base } from "viem/chains";
import {
  useAccount,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/shared/ui/button";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import { cn, formatWalletAddress } from "@/lib/utils";

/**
 * In-Mini-App deposit button. Builds a native USDC `transfer` to the
 * arena address and routes it through wagmi's Farcaster Mini App
 * connector. The UI stays active until the Base receipt confirms and
 * the server verifies which wallet funded the arena wallet.
 */

type DepositAmount = 5 | 10 | 25;

const AMOUNT_OPTIONS: readonly DepositAmount[] = [5, 10, 25] as const;

type FundingSourceRequest = {
  tx_hash: string;
};

type FundingSourceResponse = {
  funding_wallet_address: string;
  funding_wallet_tx_hash: string;
  funding_wallet_verified_at: string;
};

type ManualPhase = "idle" | "switching" | "signing" | "saving";

export function DepositButton({
  arenaAddress,
  minDepositUsdc,
  onFundingConfirmed,
}: {
  arenaAddress: string;
  minDepositUsdc: number;
  onFundingConfirmed: () => void;
}) {
  const [amount, setAmount] = useState<DepositAmount>(() =>
    pickDefaultAmount(minDepositUsdc),
  );
  const [uiError, setUiError] = useState<string | null>(null);
  const [submittedHash, setSubmittedHash] = useState<`0x${string}`>();
  const [fundingSource, setFundingSource] =
    useState<FundingSourceResponse | null>(null);
  const [manualPhase, setManualPhase] = useState<ManualPhase>("idle");

  const { isConnected, chainId } = useAccount();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const {
    writeContractAsync,
    isPending: isWalletPending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: isConfirming,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: submittedHash,
    chainId: base.id,
    query: { enabled: Boolean(submittedHash) },
  });

  const {
    mutateAsync: saveFundingSource,
    isPending: isSavingFundingSource,
    error: fundingSourceError,
    reset: resetFundingSource,
  } = useApiMutation<FundingSourceResponse, FundingSourceRequest>({
    url: "/api/arena/funding-source",
    method: "POST",
    body: (body) => body,
  });

  // Save exactly once per confirmed tx. The ref guard prevents duplicate
  // writes when React 18 Strict Mode double-invokes effects in dev.
  const savedTxRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      receipt?.status === "success" &&
      submittedHash &&
      savedTxRef.current !== submittedHash
    ) {
      savedTxRef.current = submittedHash;
      setManualPhase("saving");
      saveFundingSource({ tx_hash: submittedHash })
        .then((result) => {
          setFundingSource(result);
          setManualPhase("idle");
        })
        .catch(() => {
          savedTxRef.current = null;
          setManualPhase("idle");
        });
    }
  }, [receipt, saveFundingSource, submittedHash]);

  const amountLabel = formatUsdc(amount);

  const resetDeposit = () => {
    setUiError(null);
    setFundingSource(null);
    setSubmittedHash(undefined);
    setManualPhase("idle");
    savedTxRef.current = null;
    resetWrite();
    resetFundingSource();
  };

  const handleDeposit = async () => {
    resetDeposit();

    if (!isConnected) {
      setUiError("Connect your Farcaster wallet first.");
      return;
    }

    try {
      if (chainId !== base.id) {
        setManualPhase("switching");
        await switchChainAsync({ chainId: base.id });
      }
    } catch {
      setManualPhase("idle");
      setUiError("Couldn't switch to Base. Try again or deposit manually.");
      return;
    }

    const to = safeAddress(arenaAddress);
    if (!to) {
      setManualPhase("idle");
      setUiError("Invalid arena address. Reload and try again.");
      return;
    }

    try {
      setManualPhase("signing");
      const hash = await writeContractAsync({
        abi: erc20Abi,
        address: USDC_BASE_ADDRESS,
        functionName: "transfer",
        args: [to, parseUnits(String(amount), USDC_DECIMALS)],
        chainId: base.id,
      });
      setSubmittedHash(hash);
      setManualPhase("idle");
    } catch (err) {
      setManualPhase("idle");
      setUiError(mapWriteError(err) ?? "Deposit failed. Try again.");
    }
  };

  const finishConfirmedDeposit = () => {
    onFundingConfirmed();
    resetDeposit();
  };

  const retrySaveFundingSource = async () => {
    if (!submittedHash) return;
    resetFundingSource();
    setUiError(null);
    setManualPhase("saving");
    try {
      const result = await saveFundingSource({ tx_hash: submittedHash });
      setFundingSource(result);
    } catch {
      // The mutation state owns the user-facing error message.
    } finally {
      setManualPhase("idle");
    }
  };

  const derivedError =
    uiError ??
    mapWriteError(writeError) ??
    mapFundingSourceError(fundingSourceError) ??
    (receipt?.status === "reverted"
      ? "Transaction reverted on Base. Try again."
      : null) ??
    (receiptError ? "Transaction failed to confirm. Try again." : null);

  const phase = derivePhase({
    manualPhase,
    isSwitching,
    isWalletPending,
    isConfirming,
    isSavingFundingSource,
    hasReceipt: receipt?.status === "success",
    hasFundingSource: fundingSource !== null,
    hasError: derivedError !== null,
  });

  return (
    <div className="space-y-2">
      {phase === "confirmed" && fundingSource ? (
        <FundingConfirmedPanel
          amountLabel={amountLabel}
          fundingSource={fundingSource}
        />
      ) : (
        <div
          role="radiogroup"
          aria-label="Deposit amount"
          className="grid grid-cols-3 gap-1.5"
        >
          {AMOUNT_OPTIONS.map((opt) => {
            const isActive = opt === amount;
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => {
                  if (phase !== "idle") return;
                  setAmount(opt);
                  resetDeposit();
                }}
                disabled={phase !== "idle"}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs font-mono transition",
                  isActive
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-imperial-border bg-imperial-surface text-zinc-400 hover:border-gold/50",
                  phase !== "idle" && "opacity-60 cursor-not-allowed",
                )}
              >
                {formatUsdc(opt)}
              </button>
            );
          })}
        </div>
      )}

      {phase !== "idle" && phase !== "confirmed" && (
        <p
          className="flex items-center gap-2 text-xs text-zinc-400"
          aria-live="polite"
        >
          <span className="size-3 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          {phaseDescription(phase)}
        </p>
      )}

      <Button
        type="button"
        variant="imperial"
        className="w-full"
        onClick={phase === "confirmed" ? finishConfirmedDeposit : handleDeposit}
        disabled={phase !== "idle" && phase !== "confirmed"}
      >
        {phaseLabel(phase, amountLabel)}
      </Button>

      {derivedError && (
        <p className="text-xs text-red-400" role="alert">
          {derivedError}
        </p>
      )}

      {fundingSourceError && submittedHash ? (
        <Button
          type="button"
          variant="imperial-outline"
          className="w-full"
          onClick={retrySaveFundingSource}
        >
          Try saving again
        </Button>
      ) : derivedError && submittedHash ? (
        <Button
          type="button"
          variant="imperial-outline"
          className="w-full"
          onClick={resetDeposit}
        >
          Try another deposit
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DepositPhase =
  | "idle"
  | "switching"
  | "signing"
  | "confirming"
  | "saving"
  | "confirmed";

function derivePhase(args: {
  manualPhase: ManualPhase;
  isSwitching: boolean;
  isWalletPending: boolean;
  isConfirming: boolean;
  isSavingFundingSource: boolean;
  hasReceipt: boolean;
  hasFundingSource: boolean;
  hasError: boolean;
}): DepositPhase {
  if (args.hasFundingSource) return "confirmed";
  if (args.hasError) return "idle";
  if (args.manualPhase === "saving" || args.isSavingFundingSource) return "saving";
  if (args.isConfirming) return "confirming";
  if (args.manualPhase === "switching" || args.isSwitching) return "switching";
  if (args.manualPhase === "signing" || args.isWalletPending) return "signing";
  if (args.hasReceipt) return "saving";
  return "idle";
}

function phaseDescription(phase: DepositPhase): string {
  switch (phase) {
    case "switching":
      return "Switching your wallet to Base.";
    case "signing":
      return "Waiting for wallet approval.";
    case "confirming":
      return "Waiting for the Base transaction receipt.";
    case "saving":
      return "Verifying the USDC transfer and saving your funding wallet.";
    default:
      return "";
  }
}

function phaseLabel(phase: DepositPhase, amountLabel: string): string {
  switch (phase) {
    case "switching":
      return "Switching to Base…";
    case "signing":
      return "Confirm in wallet…";
    case "confirming":
      return "Confirming on Base…";
    case "saving":
      return "Saving funding wallet…";
    case "confirmed":
      return "Done";
    default:
      return `Deposit ${amountLabel}`;
  }
}

function FundingConfirmedPanel({
  amountLabel,
  fundingSource,
}: {
  amountLabel: string;
  fundingSource: FundingSourceResponse;
}) {
  return (
    <div className="rounded-md border border-pnl-positive/20 bg-pnl-positive/5 p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-pnl-positive/70">
          Confirmed
        </span>
        <span className="font-mono text-sm text-pnl-positive">
          {amountLabel} USDC
        </span>
      </div>
      <div className="text-xs text-zinc-400">
        Funding wallet saved:{" "}
        <span className="font-mono text-zinc-200">
          {formatWalletAddress(fundingSource.funding_wallet_address)}
        </span>
      </div>
      <a
        href={`https://basescan.org/tx/${fundingSource.funding_wallet_tx_hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-mono text-pnl-positive underline underline-offset-2 break-all"
      >
        View on BaseScan ↗
      </a>
    </div>
  );
}

function pickDefaultAmount(minDepositUsdc: number): DepositAmount {
  // Default to the smallest option that clears the mint threshold. In
  // practice this is always $5 (the policy default) but the math keeps
  // us honest if an operator ever raises the floor.
  for (const opt of AMOUNT_OPTIONS) {
    if (opt >= minDepositUsdc) return opt;
  }
  return AMOUNT_OPTIONS[AMOUNT_OPTIONS.length - 1];
}

function formatUsdc(n: number): string {
  return `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;
}

function safeAddress(raw: string): Address | null {
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

function mapWriteError(err: unknown): string | null {
  if (!err || !(err instanceof Error)) return null;
  const msg = err.message.toLowerCase();
  if (msg.includes("user rejected") || msg.includes("user denied")) {
    return "Transaction rejected in wallet.";
  }
  if (msg.includes("insufficient funds")) {
    return "Not enough USDC on Base in your connected wallet.";
  }
  return "Deposit failed. Try again.";
}

function mapFundingSourceError(err: unknown): string | null {
  if (!err || !(err instanceof Error)) return null;
  return "Transaction confirmed, but we couldn't save the funding wallet. Try again.";
}
