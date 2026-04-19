import "server-only";

import { env } from "@/lib/env";

/**
 * Minimal Privy server-wallet REST client.
 *
 * Scope in #19: wallet creation only. Signing + sponsored-gas submission
 * for swaps lives in #8 (execution pipeline); keeping this module narrow
 * means we don't ship an unused signing surface alongside the mint flow.
 *
 * Auth posture: HTTP Basic with `{PRIVY_APP_ID}:{PRIVY_APP_SECRET}`.
 * Production signing also requires a service-account authorization key
 * that signs each request body — that's a #8 concern and is not required
 * for wallet creation.
 *
 * Docs: https://docs.privy.io/api-reference/wallets-v1/create
 */

const PRIVY_API_BASE = "https://api.privy.io/v1";

export class PrivyNotConfiguredError extends Error {
  constructor() {
    super("Privy app credentials are not configured (PRIVY_APP_ID / PRIVY_APP_SECRET)");
    this.name = "PrivyNotConfiguredError";
  }
}

export class PrivyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Privy API error ${status}: ${body.slice(0, 300)}`);
    this.name = "PrivyApiError";
  }
}

export type PrivyServerWallet = {
  /** Privy canonical wallet id — stored on `arena_wallets.privy_wallet_id`. */
  id: string;
  /** Checksummed Base EOA — stored lowercased on `arena_wallets.wallet_address`. */
  address: string;
  chainType: "ethereum";
};

type CreateWalletResponse = {
  id: string;
  address: string;
  chain_type: "ethereum";
};

/**
 * Provision a new Privy server wallet for the arena.
 *
 * Idempotency note: Privy itself does NOT de-duplicate wallet creation.
 * A replay will create a second wallet. The caller (gladiator mint) is
 * responsible for guarding against replays by checking `arena_wallets`
 * for an existing row BEFORE invoking this function.
 */
export async function createServerWallet(): Promise<PrivyServerWallet> {
  const appId = env.PRIVY_APP_ID;
  const appSecret = env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new PrivyNotConfiguredError();
  }

  const auth = Buffer.from(`${appId}:${appSecret}`).toString("base64");

  const response = await fetch(`${PRIVY_API_BASE}/wallets`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "privy-app-id": appId,
      "content-type": "application/json",
    },
    body: JSON.stringify({ chain_type: "ethereum" }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new PrivyApiError(response.status, body);
  }

  const data = (await response.json()) as CreateWalletResponse;

  if (!data.id || !data.address) {
    throw new PrivyApiError(500, `Malformed response: ${JSON.stringify(data)}`);
  }

  return {
    id: data.id,
    address: data.address,
    chainType: "ethereum",
  };
}
