import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import { resolveWithdrawDestination } from "./withdraw-destination";

const ARENA_WALLET = getAddress(
  "0x1111111111111111111111111111111111111111",
);
const FUNDING_WALLET = getAddress(
  "0x2222222222222222222222222222222222222222",
);
const VERIFIED_WALLET = getAddress(
  "0x3333333333333333333333333333333333333333",
);
const CUSTODY_WALLET = getAddress(
  "0x4444444444444444444444444444444444444444",
);

describe("resolveWithdrawDestination", () => {
  it("prefers the saved funding wallet", () => {
    expect(
      resolveWithdrawDestination({
        fundingWalletAddress: FUNDING_WALLET,
        verifications: [VERIFIED_WALLET],
        custodyAddress: CUSTODY_WALLET,
        arenaAddress: ARENA_WALLET,
      }),
    ).toEqual({ address: FUNDING_WALLET, source: "funding_wallet" });
  });

  it("falls back to a Farcaster verified wallet", () => {
    expect(
      resolveWithdrawDestination({
        fundingWalletAddress: null,
        verifications: [VERIFIED_WALLET],
        custodyAddress: CUSTODY_WALLET,
        arenaAddress: ARENA_WALLET,
      }),
    ).toEqual({ address: VERIFIED_WALLET, source: "verification" });
  });

  it("falls back to custody when no funding or verified wallet is usable", () => {
    expect(
      resolveWithdrawDestination({
        fundingWalletAddress: ARENA_WALLET,
        verifications: [ARENA_WALLET, "not-an-address"],
        custodyAddress: CUSTODY_WALLET,
        arenaAddress: ARENA_WALLET,
      }),
    ).toEqual({ address: CUSTODY_WALLET, source: "custody" });
  });

  it("returns null when every destination is missing or points at the arena wallet", () => {
    expect(
      resolveWithdrawDestination({
        fundingWalletAddress: ARENA_WALLET,
        verifications: [ARENA_WALLET],
        custodyAddress: ARENA_WALLET,
        arenaAddress: ARENA_WALLET,
      }),
    ).toBeNull();
  });
});
