import "server-only";

import { decode as decodeJfs, verify as verifyJfs } from "@farcaster/jfs";
import { createPublicClient, http, type Hex } from "viem";
import { optimism } from "viem/chains";

const KEY_REGISTRY_ADDRESS = "0x00000000Fc1237824fb747aBDE0FF18990E59b7e";
const SNAP_TIMESTAMP_SKEW_SECONDS = 5 * 60;

const KEY_REGISTRY_ABI = [
  {
    inputs: [
      { name: "fid", type: "uint256" },
      { name: "key", type: "bytes" },
    ],
    name: "keyDataOf",
    outputs: [
      {
        components: [
          { name: "state", type: "uint8" },
          { name: "keyType", type: "uint32" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type SnapActionPayload = {
  fid?: number;
  inputs?: Record<string, unknown>;
  timestamp?: number;
  audience?: string;
  user?: {
    fid?: number;
  };
  surface?: {
    type?: string;
  };
};

export class SnapJfsError extends Error {
  constructor(
    message: string,
    public readonly status = 401,
  ) {
    super(message);
    this.name = "SnapJfsError";
  }
}

const optimismClient = createPublicClient({
  chain: optimism,
  transport: http(),
});

export type KeyRegistryKeyData = { state: number; keyType: number };

type KeyRegistryReader = (fid: number, key: Hex) => Promise<KeyRegistryKeyData>;

async function defaultKeyRegistryRead(fid: number, key: Hex): Promise<KeyRegistryKeyData> {
  return optimismClient.readContract({
    address: KEY_REGISTRY_ADDRESS,
    abi: KEY_REGISTRY_ABI,
    functionName: "keyDataOf",
    args: [BigInt(fid), key],
  });
}

let keyRegistryReader: KeyRegistryReader = defaultKeyRegistryRead;

/**
 * Replaces the Optimism key-registry read for unit tests. Pass `null` to restore
 * the default (live RPC).
 */
export function setKeyRegistryReaderForTests(reader: KeyRegistryReader | null): void {
  keyRegistryReader = reader ?? defaultKeyRegistryRead;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

async function appKeyIsActive(fid: number, key: Hex): Promise<boolean> {
  const result = await keyRegistryReader(fid, key);
  return result.state === 1 && result.keyType === 1;
}

export async function verifySnapActionRequest(
  request: Request,
): Promise<{ fid: number; payload: SnapActionPayload }> {
  const raw = await request.text();
  const origin = new URL(request.url).origin;

  try {
    await verifyJfs({ data: raw, keyTypes: ["app_key"] });
  } catch {
    throw new SnapJfsError("Invalid snap signature");
  }

  let decoded;
  try {
    decoded = decodeJfs<SnapActionPayload>(raw);
  } catch {
    throw new SnapJfsError("Invalid snap payload", 400);
  }

  const headerFid = positiveInteger(decoded.header.fid);
  const payloadFid = positiveInteger(decoded.payload.user?.fid ?? decoded.payload.fid);
  if (!headerFid || !payloadFid || headerFid !== payloadFid) {
    throw new SnapJfsError("Snap FID mismatch", 401);
  }

  if (decoded.payload.audience !== origin) {
    throw new SnapJfsError("Invalid snap audience", 401);
  }

  const timestamp = positiveInteger(decoded.payload.timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !timestamp ||
    Math.abs(nowSeconds - timestamp) > SNAP_TIMESTAMP_SKEW_SECONDS
  ) {
    throw new SnapJfsError("Expired snap payload", 401);
  }

  let active = false;
  try {
    active = await appKeyIsActive(headerFid, decoded.header.key);
  } catch {
    active = false;
  }

  if (!active) {
    throw new SnapJfsError("Inactive snap signer", 401);
  }

  return { fid: headerFid, payload: decoded.payload };
}
