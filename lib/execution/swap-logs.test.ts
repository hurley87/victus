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
  SwapLogMissingError,
  decodeSwapReceipt,
  type SwapReceiptLike,
} from "./swap-logs";

const ARENA_WALLET = getAddress(
  "0x1111111111111111111111111111111111111111",
);
const ALLOWANCE_HOLDER = getAddress(
  "0x0000000000001fF3684f28c67538d4D072C22734",
);
const AERO_ADDRESS = getAddress(
  "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
);
const DEGEN_ADDRESS = getAddress(
  "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
);
const POOL_ONE = getAddress("0x2222222222222222222222222222222222222222");
const POOL_TWO = getAddress("0x3333333333333333333333333333333333333333");

/**
 * Helper to assemble a `Transfer` event log matching viem's expected
 * shape. `parseEventLogs` only needs `address`, `topics`, and `data`
 * to decode — the other fields satisfy the `Log` type.
 */
function makeTransferLog(args: {
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
  logIndex: number;
}): Log {
  const topics = encodeEventTopics({
    abi: erc20Abi,
    eventName: "Transfer",
    args: { from: args.from, to: args.to },
  }) as [Hex, ...Hex[]];
  const data = pad(toHex(args.value), { size: 32 });
  return {
    address: args.token,
    topics,
    data,
    blockHash: "0x0",
    blockNumber: BigInt(0),
    logIndex: args.logIndex,
    transactionHash: "0x0",
    transactionIndex: 0,
    removed: false,
  } as unknown as Log;
}

function makeReceipt(logs: Log[]): SwapReceiptLike {
  return { logs };
}

describe("decodeSwapReceipt — AERO buy (single hop)", () => {
  it("extracts net USDC-out + AERO-in with correct price and precision", () => {
    // 1 USDC in, 0.8214 AERO out → price 1.217458… USDC/AERO
    const usdcSpent = BigInt(1_000_000); // 6 decimals
    const aeroReceived = BigInt("821400000000000000"); // 18 decimals

    const receipt = makeReceipt([
      makeTransferLog({
        token: USDC_BASE_ADDRESS,
        from: ARENA_WALLET,
        to: POOL_ONE,
        value: usdcSpent,
        logIndex: 0,
      }),
      makeTransferLog({
        token: AERO_ADDRESS,
        from: POOL_ONE,
        to: ARENA_WALLET,
        value: aeroReceived,
        logIndex: 1,
      }),
    ]);

    const decoded = decodeSwapReceipt(receipt, {
      walletAddress: ARENA_WALLET,
      assetAddress: AERO_ADDRESS,
      assetDecimals: 18,
    });

    expect(decoded.direction).toBe("usdc_to_asset");
    expect(decoded.usdcBaseUnits).toBe(usdcSpent);
    expect(decoded.assetBaseUnits).toBe(aeroReceived);
    expect(decoded.quantity).toBe("0.8214");
    // 1 / 0.8214 = 1.217433649866080... USDC/AERO
    expect(decoded.executionPriceUsdc).toMatch(/^1\.217433/);
    expect(decoded.quantityNumber).toBeCloseTo(0.8214, 6);
    expect(decoded.executionPriceUsdcNumber).toBeCloseTo(
      1 / 0.8214,
      6,
    );
    expect(decoded.usdcHumanNumber).toBeCloseTo(1, 6);
  });
});

describe("decodeSwapReceipt — DEGEN buy (multi-hop router)", () => {
  it("collapses router → pool → wallet hops into the realized fill", () => {
    // 5 USDC in (via AllowanceHolder → Pool1 → Pool2 → ...), then
    // DEGEN hops Pool2 → Router → Wallet. The helper should only see
    // the arena wallet's net flow per token.
    const usdcSpent = BigInt(5_000_000);
    const degenReceived = BigInt("450000000000000000000"); // 450 DEGEN (18d)

    const receipt = makeReceipt([
      makeTransferLog({
        token: USDC_BASE_ADDRESS,
        from: ARENA_WALLET,
        to: ALLOWANCE_HOLDER,
        value: usdcSpent,
        logIndex: 0,
      }),
      makeTransferLog({
        token: USDC_BASE_ADDRESS,
        from: ALLOWANCE_HOLDER,
        to: POOL_ONE,
        value: usdcSpent,
        logIndex: 1,
      }),
      makeTransferLog({
        token: DEGEN_ADDRESS,
        from: POOL_ONE,
        to: POOL_TWO,
        value: degenReceived,
        logIndex: 2,
      }),
      makeTransferLog({
        token: DEGEN_ADDRESS,
        from: POOL_TWO,
        to: ARENA_WALLET,
        value: degenReceived,
        logIndex: 3,
      }),
    ]);

    const decoded = decodeSwapReceipt(receipt, {
      walletAddress: ARENA_WALLET,
      assetAddress: DEGEN_ADDRESS,
      assetDecimals: 18,
    });

    expect(decoded.usdcBaseUnits).toBe(usdcSpent);
    expect(decoded.assetBaseUnits).toBe(degenReceived);
    expect(decoded.quantity).toBe("450");
    // 5 / 450 = 0.0111... USDC/DEGEN
    expect(decoded.executionPriceUsdcNumber).toBeCloseTo(5 / 450, 8);
  });
});

describe("decodeSwapReceipt — refund / dust handling", () => {
  it("nets out a partial USDC refund routed back to the wallet", () => {
    // Router pulls 1 USDC, refunds 0.01 USDC dust. Net spend = 0.99.
    const usdcPulled = BigInt(1_000_000);
    const usdcRefund = BigInt(10_000); // 0.01 USDC
    const aeroReceived = BigInt("820000000000000000"); // 0.82 AERO

    const receipt = makeReceipt([
      makeTransferLog({
        token: USDC_BASE_ADDRESS,
        from: ARENA_WALLET,
        to: ALLOWANCE_HOLDER,
        value: usdcPulled,
        logIndex: 0,
      }),
      makeTransferLog({
        token: USDC_BASE_ADDRESS,
        from: ALLOWANCE_HOLDER,
        to: ARENA_WALLET,
        value: usdcRefund,
        logIndex: 1,
      }),
      makeTransferLog({
        token: AERO_ADDRESS,
        from: POOL_ONE,
        to: ARENA_WALLET,
        value: aeroReceived,
        logIndex: 2,
      }),
    ]);

    const decoded = decodeSwapReceipt(receipt, {
      walletAddress: ARENA_WALLET,
      assetAddress: AERO_ADDRESS,
      assetDecimals: 18,
    });

    expect(decoded.usdcBaseUnits).toBe(usdcPulled - usdcRefund);
    expect(decoded.assetBaseUnits).toBe(aeroReceived);
    expect(decoded.usdcHumanNumber).toBeCloseTo(0.99, 6);
  });
});

describe("decodeSwapReceipt — missing data", () => {
  it("throws SwapLogMissingError when no matching transfers exist", () => {
    const receipt = makeReceipt([]);

    expect(() =>
      decodeSwapReceipt(receipt, {
        walletAddress: ARENA_WALLET,
        assetAddress: AERO_ADDRESS,
        assetDecimals: 18,
      }),
    ).toThrow(SwapLogMissingError);
  });

  it("throws when USDC-out event is present but asset-in is not", () => {
    const receipt = makeReceipt([
      makeTransferLog({
        token: USDC_BASE_ADDRESS,
        from: ARENA_WALLET,
        to: POOL_ONE,
        value: BigInt(1_000_000),
        logIndex: 0,
      }),
    ]);

    expect(() =>
      decodeSwapReceipt(receipt, {
        walletAddress: ARENA_WALLET,
        assetAddress: AERO_ADDRESS,
        assetDecimals: 18,
      }),
    ).toThrow(SwapLogMissingError);
  });

  it("ignores transfers on unrelated tokens (e.g. rebase coins)", () => {
    const UNRELATED = getAddress(
      "0x9999999999999999999999999999999999999999",
    );

    const receipt = makeReceipt([
      makeTransferLog({
        token: UNRELATED,
        from: POOL_ONE,
        to: ARENA_WALLET,
        value: BigInt(42),
        logIndex: 0,
      }),
      makeTransferLog({
        token: USDC_BASE_ADDRESS,
        from: ARENA_WALLET,
        to: POOL_ONE,
        value: BigInt(1_000_000),
        logIndex: 1,
      }),
      makeTransferLog({
        token: AERO_ADDRESS,
        from: POOL_ONE,
        to: ARENA_WALLET,
        value: BigInt("1000000000000000000"),
        logIndex: 2,
      }),
    ]);

    const decoded = decodeSwapReceipt(receipt, {
      walletAddress: ARENA_WALLET,
      assetAddress: AERO_ADDRESS,
      assetDecimals: 18,
    });

    expect(decoded.quantity).toBe("1");
  });
});

describe("decodeSwapReceipt — sell direction (not yet implemented)", () => {
  it("throws a clear error for asset_to_usdc until #10 lands", () => {
    const receipt = makeReceipt([]);

    expect(() =>
      decodeSwapReceipt(receipt, {
        walletAddress: ARENA_WALLET,
        assetAddress: AERO_ADDRESS,
        assetDecimals: 18,
        direction: "asset_to_usdc",
      }),
    ).toThrow(/not implemented/);
  });
});
