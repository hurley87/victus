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
import { USDC_BASE_ADDRESS, USDC_DECIMALS } from "@/lib/chain/addresses";
import { cn } from "@/lib/utils";

/**
 * In-Mini-App deposit button. Builds a native USDC `transfer` to the
 * arena address and routes it through wagmi's Farcaster Mini App
 * connector. On confirmed receipt, nudges the parent to refetch
 * `/api/arena/me`; `getArenaProfile` self-heals `pending_funding → alive`
 * on whichever poll first sees the deposit on the server's RPC.
 */

type DepositAmount = 5 | 10 | 25;

const AMOUNT_OPTIONS: readonly DepositAmount[] = [5, 10, 25] as const;

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

  const { isConnected, chainId } = useAccount();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const {
    writeContract,
    data: txHash,
    isPending: isSigning,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: isConfirming,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: base.id,
    query: { enabled: Boolean(txHash) },
  });

  // Fire the parent refetch exactly once per confirmed tx. The ref
  // guard prevents duplicate refetches when React 18 Strict Mode
  // double-invokes the effect in dev or when `receipt` re-emits while
  // still in the success state.
  const notifiedTxRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      receipt?.status === "success" &&
      txHash &&
      notifiedTxRef.current !== txHash
    ) {
      notifiedTxRef.current = txHash;
      onFundingConfirmed();
    }
  }, [receipt, txHash, onFundingConfirmed]);

  const amountLabel = formatUsdc(amount);

  const handleDeposit = async () => {
    setUiError(null);

    if (!isConnected) {
      setUiError("Connect your Farcaster wallet first.");
      return;
    }

    try {
      if (chainId !== base.id) {
        await switchChainAsync({ chainId: base.id });
      }
    } catch {
      setUiError("Couldn't switch to Base. Try again or deposit manually.");
      return;
    }

    const to = safeAddress(arenaAddress);
    if (!to) {
      setUiError("Invalid arena address. Reload and try again.");
      return;
    }

    writeContract({
      abi: erc20Abi,
      address: USDC_BASE_ADDRESS,
      functionName: "transfer",
      args: [to, parseUnits(String(amount), USDC_DECIMALS)],
      chainId: base.id,
    });
  };

  const derivedError =
    uiError ??
    mapWriteError(writeError) ??
    (receiptError ? "Transaction failed to confirm. Try again." : null);

  const phase = derivePhase({
    isSwitching,
    isSigning,
    isConfirming,
    hasReceipt: receipt?.status === "success",
  });

  return (
    <div className="space-y-2">
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
                resetWrite();
                setUiError(null);
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

      <Button
        type="button"
        variant="imperial"
        className="w-full"
        onClick={handleDeposit}
        disabled={phase !== "idle"}
      >
        {phaseLabel(phase, amountLabel)}
      </Button>

      {derivedError && (
        <p className="text-xs text-red-400" role="alert">
          {derivedError}
        </p>
      )}
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
  | "confirmed";

function derivePhase(args: {
  isSwitching: boolean;
  isSigning: boolean;
  isConfirming: boolean;
  hasReceipt: boolean;
}): DepositPhase {
  if (args.isSwitching) return "switching";
  if (args.isSigning) return "signing";
  if (args.isConfirming) return "confirming";
  if (args.hasReceipt) return "confirmed";
  return "idle";
}

function phaseLabel(phase: DepositPhase, amountLabel: string): string {
  switch (phase) {
    case "switching":
      return "Switching to Base…";
    case "signing":
      return "Confirm in wallet…";
    case "confirming":
      return "Confirming on Base…";
    case "confirmed":
      return "Funded ✓";
    default:
      return `Deposit ${amountLabel}`;
  }
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
