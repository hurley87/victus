import { describe, expect, it } from "vitest";
import {
  encodeEventTopics,
  erc20Abi,
  getAddress,
  pad,
  toHex,
  type Address,
  type Hex,
  type Log,
} from "viem";

import { USDC_BASE_ADDRESS } from "@/lib/chain/addresses";
import {
  FundingSourceValidationError,
  validateFundingSourceReceipt,
  type FundingReceiptLike,
} from "./funding-source-validation";

const ARENA_WALLET = getAddress(
  "0x1111111111111111111111111111111111111111",
);
const FUNDER = getAddress("0x2222222222222222222222222222222222222222");
const OTHER_WALLET = getAddress("0x3333333333333333333333333333333333333333");
const OTHER_TOKEN = getAddress("0x4444444444444444444444444444444444444444");

function makeTransferLog(args: {
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
  logIndex?: number;
}): Log {
  const topics = encodeEventTopics({
    abi: erc20Abi,
    eventName: "Transfer",
    args: { from: args.from, to: args.to },
  }) as [Hex, ...Hex[]];

  return {
    address: args.token,
    topics,
    data: pad(toHex(args.value), { size: 32 }),
    blockHash: "0x0",
    blockNumber: BigInt(0),
    logIndex: args.logIndex ?? 0,
    transactionHash: "0x0",
    transactionIndex: 0,
    removed: false,
  } as unknown as Log;
}

function makeReceipt(logs: Log[], status = "success"): FundingReceiptLike {
  return { status, logs };
}

describe("validateFundingSourceReceipt", () => {
  it("extracts the funder from a successful USDC transfer into the arena wallet", () => {
    const result = validateFundingSourceReceipt(
      makeReceipt([
        makeTransferLog({
          token: USDC_BASE_ADDRESS,
          from: FUNDER,
          to: ARENA_WALLET,
          value: BigInt(5_000_000),
        }),
      ]),
      ARENA_WALLET,
    );

    expect(result).toEqual({
      fundingWalletAddress: FUNDER,
      amountBaseUnits: BigInt(5_000_000),
    });
  });

  it("rejects reverted transactions", () => {
    expect(() =>
      validateFundingSourceReceipt(makeReceipt([], "reverted"), ARENA_WALLET),
    ).toThrow(FundingSourceValidationError);
  });

  it("rejects transfers from the wrong token", () => {
    expect(() =>
      validateFundingSourceReceipt(
        makeReceipt([
          makeTransferLog({
            token: OTHER_TOKEN,
            from: FUNDER,
            to: ARENA_WALLET,
            value: BigInt(5_000_000),
          }),
        ]),
        ARENA_WALLET,
      ),
    ).toThrow(/No positive Base USDC transfer/);
  });

  it("rejects USDC transfers to another recipient", () => {
    expect(() =>
      validateFundingSourceReceipt(
        makeReceipt([
          makeTransferLog({
            token: USDC_BASE_ADDRESS,
            from: FUNDER,
            to: OTHER_WALLET,
            value: BigInt(5_000_000),
          }),
        ]),
        ARENA_WALLET,
      ),
    ).toThrow(/No positive Base USDC transfer/);
  });

  it("rejects receipts without a positive matching USDC transfer", () => {
    expect(() =>
      validateFundingSourceReceipt(
        makeReceipt([
          makeTransferLog({
            token: USDC_BASE_ADDRESS,
            from: FUNDER,
            to: ARENA_WALLET,
            value: BigInt(0),
          }),
        ]),
        ARENA_WALLET,
      ),
    ).toThrow(/No positive Base USDC transfer/);
  });
});
