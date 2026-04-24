import {
  decodeEventLog,
  erc20Abi,
  getAddress,
  isAddress,
  type Address,
  type Hex,
  type Log,
} from "viem";

import { USDC_BASE_ADDRESS } from "@/lib/chain/addresses";

export class FundingSourceValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_arena_address"
      | "receipt_reverted"
      | "missing_usdc_transfer",
  ) {
    super(message);
    this.name = "FundingSourceValidationError";
  }
}

export type FundingReceiptLike = {
  status?: "success" | "reverted" | string;
  logs: Pick<Log, "address" | "topics" | "data">[];
};

export type FundingSourceValidationResult = {
  fundingWalletAddress: Address;
  amountBaseUnits: bigint;
};

export function validateFundingSourceReceipt(
  receipt: FundingReceiptLike,
  arenaAddress: string,
): FundingSourceValidationResult {
  if (!isAddress(arenaAddress)) {
    throw new FundingSourceValidationError(
      "Invalid arena wallet address",
      "invalid_arena_address",
    );
  }

  if (receipt.status !== "success") {
    throw new FundingSourceValidationError(
      "Funding transaction did not succeed",
      "receipt_reverted",
    );
  }

  const arena = getAddress(arenaAddress);

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== USDC_BASE_ADDRESS) continue;

    const decoded = tryDecodeTransferLog(log);
    if (!decoded) continue;
    if (decoded.to !== arena) continue;
    if (decoded.value <= BigInt(0)) continue;

    return {
      fundingWalletAddress: decoded.from,
      amountBaseUnits: decoded.value,
    };
  }

  throw new FundingSourceValidationError(
    "No positive Base USDC transfer into the arena wallet was found",
    "missing_usdc_transfer",
  );
}

function tryDecodeTransferLog(
  log: Pick<Log, "topics" | "data">,
): { from: Address; to: Address; value: bigint } | null {
  try {
    const decoded = decodeEventLog({
      abi: erc20Abi,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });

    if (decoded.eventName !== "Transfer") return null;

    return {
      from: getAddress(decoded.args.from),
      to: getAddress(decoded.args.to),
      value: decoded.args.value,
    };
  } catch {
    return null;
  }
}
