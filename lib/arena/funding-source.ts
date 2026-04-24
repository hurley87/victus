import "server-only";

import { getAddress, isHash, type Address, type Hex } from "viem";

import { basePublicClient } from "@/lib/chain/client";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  FundingSourceValidationError,
  validateFundingSourceReceipt,
} from "./funding-source-validation";

export class FundingSourceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class FundingSourceBadRequestError extends FundingSourceError {
  constructor(message = "Invalid funding transaction") {
    super(message, 400);
  }
}

export class FundingSourceNotFoundError extends FundingSourceError {
  constructor() {
    super("No arena wallet found for this user", 404);
  }
}

export class FundingSourceUnavailableError extends FundingSourceError {
  constructor(message = "Funding source verification is temporarily unavailable") {
    super(message, 503);
  }
}

export type FundingSourceResult = {
  funding_wallet_address: Address;
  funding_wallet_tx_hash: Hex;
  funding_wallet_verified_at: string;
};

export async function verifyAndSaveFundingSource(params: {
  userId: string;
  txHash: string;
}): Promise<FundingSourceResult> {
  if (!isHash(params.txHash)) {
    throw new FundingSourceBadRequestError("Invalid transaction hash");
  }
  const txHash = params.txHash as Hex;

  const { data: wallet, error } = await supabaseAdmin
    .from("arena_wallets")
    .select("id, wallet_address")
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) {
    throw new FundingSourceUnavailableError(
      `Failed to read arena wallet: ${error.message}`,
    );
  }
  if (!wallet?.id || !wallet.wallet_address) {
    throw new FundingSourceNotFoundError();
  }

  let receipt;
  try {
    receipt = await basePublicClient.getTransactionReceipt({ hash: txHash });
  } catch (err) {
    throw new FundingSourceBadRequestError(
      err instanceof Error
        ? `Transaction receipt not found: ${err.message}`
        : "Transaction receipt not found",
    );
  }

  let verified;
  try {
    verified = validateFundingSourceReceipt(receipt, wallet.wallet_address);
  } catch (err) {
    if (err instanceof FundingSourceValidationError) {
      throw new FundingSourceBadRequestError(err.message);
    }
    throw err;
  }

  const verifiedAt = new Date().toISOString();
  const fundingWalletAddress = getAddress(verified.fundingWalletAddress);

  const { error: updateErr } = await supabaseAdmin
    .from("arena_wallets")
    .update({
      funding_wallet_address: fundingWalletAddress,
      funding_wallet_tx_hash: txHash,
      funding_wallet_verified_at: verifiedAt,
    })
    .eq("id", wallet.id);

  if (updateErr) {
    throw new FundingSourceUnavailableError(
      `Failed to save funding wallet: ${updateErr.message}`,
    );
  }

  console.info("arena.funding_source_verified", {
    user_id: params.userId,
    arena_address: wallet.wallet_address,
    funding_wallet_address: fundingWalletAddress,
    funding_wallet_tx_hash: params.txHash,
    amount_base_units: verified.amountBaseUnits.toString(),
  });

  return {
    funding_wallet_address: fundingWalletAddress,
    funding_wallet_tx_hash: txHash,
    funding_wallet_verified_at: verifiedAt,
  };
}
