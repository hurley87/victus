import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

import { decode as decodeJfs, verify as verifyJfs } from "@farcaster/jfs";

import {
  setKeyRegistryReaderForTests,
  verifySnapActionRequest,
} from "./jfs";

vi.mock("@farcaster/jfs", () => ({
  verify: vi.fn(),
  decode: vi.fn(),
}));

const MOCK_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;

function buildDecoded(overrides: {
  headerFid?: number;
  payloadFid?: number;
  audience?: string;
  timestamp?: number;
} = {}) {
  const headerFid = overrides.headerFid ?? 42;
  const payloadFid = overrides.payloadFid ?? 42;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    header: { fid: headerFid, key: MOCK_KEY },
    payload: {
      user: { fid: payloadFid },
      audience: overrides.audience ?? "https://example.com",
      timestamp: overrides.timestamp ?? nowSeconds,
    },
  };
}

describe("verifySnapActionRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00.000Z"));
    setKeyRegistryReaderForTests(async () => ({ state: 1, keyType: 1 }));
    vi.mocked(verifyJfs).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    setKeyRegistryReaderForTests(null);
    vi.clearAllMocks();
  });

  it("returns fid and payload when signature, audience, timestamp, and app key are valid", async () => {
    const decoded = buildDecoded();
    vi.mocked(decodeJfs).mockReturnValue(decoded as ReturnType<typeof decodeJfs>);
    const keyReader = vi.fn(async () => ({ state: 1, keyType: 1 }));
    setKeyRegistryReaderForTests(keyReader);

    const request = new Request("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });

    const result = await verifySnapActionRequest(request);

    expect(result.fid).toBe(42);
    expect(result.payload).toEqual(decoded.payload);
    expect(verifyJfs).toHaveBeenCalledWith({
      data: "{}",
      keyTypes: ["app_key"],
    });
    expect(keyReader).toHaveBeenCalledWith(42, MOCK_KEY);
  });

  it("throws 401 when verifyJfs rejects", async () => {
    vi.mocked(verifyJfs).mockRejectedValue(new Error("bad sig"));

    const request = new Request("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });

    await expect(verifySnapActionRequest(request)).rejects.toMatchObject({
      message: "Invalid snap signature",
      status: 401,
    });
  });

  it("throws 401 when header and payload fids do not match", async () => {
    vi.mocked(decodeJfs).mockReturnValue(
      buildDecoded({ headerFid: 1, payloadFid: 2 }) as ReturnType<typeof decodeJfs>,
    );

    const request = new Request("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });

    await expect(verifySnapActionRequest(request)).rejects.toMatchObject({
      message: "Snap FID mismatch",
      status: 401,
    });
  });

  it("throws 401 when audience does not match request origin", async () => {
    vi.mocked(decodeJfs).mockReturnValue(
      buildDecoded({ audience: "https://other.example.com" }) as ReturnType<
        typeof decodeJfs
      >,
    );

    const request = new Request("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });

    await expect(verifySnapActionRequest(request)).rejects.toMatchObject({
      message: "Invalid snap audience",
      status: 401,
    });
  });

  it("throws 401 when timestamp is more than 5 minutes in the past", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    vi.mocked(decodeJfs).mockReturnValue(
      buildDecoded({ timestamp: nowSeconds - 6 * 60 }) as ReturnType<typeof decodeJfs>,
    );

    const request = new Request("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });

    await expect(verifySnapActionRequest(request)).rejects.toMatchObject({
      message: "Expired snap payload",
      status: 401,
    });
  });

  it("throws 401 when timestamp is more than 5 minutes in the future", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    vi.mocked(decodeJfs).mockReturnValue(
      buildDecoded({ timestamp: nowSeconds + 6 * 60 }) as ReturnType<typeof decodeJfs>,
    );

    const request = new Request("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });

    await expect(verifySnapActionRequest(request)).rejects.toMatchObject({
      message: "Expired snap payload",
      status: 401,
    });
  });

  it("throws 401 when app key is not active (wrong state or keyType)", async () => {
    vi.mocked(decodeJfs).mockReturnValue(
      buildDecoded() as ReturnType<typeof decodeJfs>,
    );
    setKeyRegistryReaderForTests(async () => ({ state: 0, keyType: 1 }));

    const request = new Request("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });

    await expect(verifySnapActionRequest(request)).rejects.toMatchObject({
      message: "Inactive snap signer",
      status: 401,
    });
  });

  it("throws 401 when app key has wrong keyType", async () => {
    vi.mocked(decodeJfs).mockReturnValue(
      buildDecoded() as ReturnType<typeof decodeJfs>,
    );
    setKeyRegistryReaderForTests(async () => ({ state: 1, keyType: 2 }));

    const request = new Request("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });

    await expect(verifySnapActionRequest(request)).rejects.toMatchObject({
      message: "Inactive snap signer",
      status: 401,
    });
  });

  it("throws 400 when decodeJfs throws", async () => {
    vi.mocked(decodeJfs).mockImplementation(() => {
      throw new Error("bad cbor");
    });

    const request = new Request("https://example.com/api/snaps/trade-command", {
      method: "POST",
      body: "{}",
    });

    await expect(verifySnapActionRequest(request)).rejects.toMatchObject({
      message: "Invalid snap payload",
      status: 400,
    });
  });
});
