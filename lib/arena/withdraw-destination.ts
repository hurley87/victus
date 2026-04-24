import { getAddress, isAddress, type Address } from "viem";

export type WithdrawDestinationSource =
  | "funding_wallet"
  | "verification"
  | "custody";

export type WithdrawDestination = {
  address: Address;
  source: WithdrawDestinationSource;
};

function extractVerifiedWithdrawDestination(
  verifications: unknown,
  arenaAddress: string,
): WithdrawDestination | null {
  const arenaAddressLower = arenaAddress.toLowerCase();
  const entries = Array.isArray(verifications) ? verifications : [];

  for (const raw of entries) {
    if (typeof raw !== "string") continue;
    if (!isAddress(raw)) continue;
    if (raw.toLowerCase() === arenaAddressLower) continue;
    return { address: getAddress(raw), source: "verification" };
  }

  return null;
}

export function resolveWithdrawDestination(params: {
  fundingWalletAddress?: string | null;
  verifications: unknown;
  custodyAddress?: string | null;
  arenaAddress: string;
}): WithdrawDestination | null {
  const fundingWallet = getFundingWalletDestination(params);
  if (fundingWallet) return fundingWallet;

  const verified = extractVerifiedWithdrawDestination(
    params.verifications,
    params.arenaAddress,
  );
  if (verified) return verified;

  const arenaAddressLower = params.arenaAddress.toLowerCase();
  if (
    typeof params.custodyAddress === "string" &&
    isAddress(params.custodyAddress) &&
    params.custodyAddress.toLowerCase() !== arenaAddressLower
  ) {
    return { address: getAddress(params.custodyAddress), source: "custody" };
  }

  return null;
}

export function getFundingWalletDestination(params: {
  fundingWalletAddress?: string | null;
  arenaAddress: string;
}): WithdrawDestination | null {
  const arenaAddressLower = params.arenaAddress.toLowerCase();

  if (
    typeof params.fundingWalletAddress === "string" &&
    isAddress(params.fundingWalletAddress) &&
    params.fundingWalletAddress.toLowerCase() !== arenaAddressLower
  ) {
    return {
      address: getAddress(params.fundingWalletAddress),
      source: "funding_wallet",
    };
  }

  return null;
}
