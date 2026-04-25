import "server-only";

import { env } from "@/lib/env";

/**
 * Minimal Privy server-wallet REST client.
 *
 * Auth posture: HTTP Basic with `{PRIVY_APP_ID}:{PRIVY_APP_SECRET}`.
 * Our wallets are created without an `owner` (see `createServerWallet`),
 * so the `privy-authorization-signature` header is not required. A
 * future migration that adds owner-scoped policies will need to sign
 * each request body with an authorization key.
 *
 * Docs:
 * - https://docs.privy.io/api-reference/wallets/ethereum/eth-send-transaction
 * - https://docs.privy.io/wallets/gas-and-asset-management/gas/transaction-handling
 * - https://docs.privy.io/api-reference/transactions/get
 */

const PRIVY_API_BASE = "https://api.privy.io/v1";

/** CAIP-2 identifier for Base mainnet. */
const BASE_CAIP2 = "eip155:8453" as const;

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

/**
 * Thrown when a Privy transaction does not reach a terminal status
 * within the configured timeout. The transaction may still confirm
 * later — callers should treat this as "unknown" rather than "failed"
 * and reconcile via the `transactionId` later (out of scope for MVP).
 */
export class PrivyTransactionTimeoutError extends Error {
  constructor(public readonly transactionId: string) {
    super(`Privy transaction ${transactionId} did not confirm within the timeout`);
    this.name = "PrivyTransactionTimeoutError";
  }
}

/**
 * Thrown when a Privy transaction reaches a terminal non-success
 * status (`execution_reverted`, `failed`, `replaced`, `provider_error`).
 */
export class PrivyTransactionFailedError extends Error {
  constructor(
    public readonly transactionId: string,
    public readonly status: PrivyTransactionTerminalStatus,
    public readonly transactionHash: string | null,
  ) {
    super(`Privy transaction ${transactionId} ended in status ${status}`);
    this.name = "PrivyTransactionFailedError";
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
 * A replay will create a second wallet. The caller (arena wallet provisioning) is
 * responsible for guarding against replays by checking `arena_wallets`
 * for an existing row BEFORE invoking this function.
 */
export async function createServerWallet(): Promise<PrivyServerWallet> {
  const response = await privyFetch("/wallets", {
    method: "POST",
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

// ---------------------------------------------------------------------------
// eth_sendTransaction
// ---------------------------------------------------------------------------

export type SignAndSendTransactionParams = {
  walletId: string;
  /** Recipient address (checksummed or lowercase hex). */
  to: string;
  /** Optional 0x-prefixed calldata. */
  data?: string;
  /**
   * Optional value in wei as a 0x-prefixed hex string. Omit for pure
   * contract calls (e.g. ERC-20 transfers).
   */
  value?: string;
  /**
   * Enable Privy gas sponsorship. Defaults to `true` — Commodus
   * sponsors gas for every tx the arena wallet sends (swap, fee
   * transfer, user withdraw). The arena wallet never needs to hold ETH.
   */
  sponsor?: boolean;
  /**
   * Developer-provided reference ID. Recorded on the Privy transaction
   * object; surfaced in webhooks and `GET /v1/transactions`. Used for
   * reconciliation, NOT as a dedupe key — Privy does not reject
   * duplicate `reference_id` values. Up to 64 chars.
   */
  referenceId?: string;
};

export type PrivyTransactionResult = {
  /** Privy's internal transaction id — use this to poll for confirmation. */
  transactionId: string;
  /**
   * UserOperation hash when `sponsor: true` (our default). Always a
   * 0x-prefixed string — distinct from the on-chain tx hash.
   */
  userOperationHash: string | null;
  /**
   * On-chain tx hash. Empty string on the sponsored path (materializes
   * after confirmation); set immediately when `sponsor: false`.
   */
  hash: string;
};

type SendTransactionResponse = {
  method: "eth_sendTransaction";
  data: {
    hash?: string;
    user_operation_hash?: string;
    caip2: string;
    transaction_id: string;
  };
};

/**
 * Sign and broadcast an EVM transaction from a Privy server wallet.
 *
 * Sponsored path (`sponsor: true`, default):
 * - Response returns `{ transactionId, userOperationHash, hash: "" }`
 *   immediately. The bundler confirms on-chain within ~1–10s on Base.
 * - Pass the `transactionId` to `waitForTransaction` to resolve the
 *   final `transaction_hash`.
 *
 * Unsponsored path (`sponsor: false`):
 * - Response carries the tx hash synchronously. The arena wallet must
 *   hold enough ETH to pay for its own gas. Currently unused —
 *   documented as a fallback posture only.
 */
export async function signAndSendTransaction(
  params: SignAndSendTransactionParams,
): Promise<PrivyTransactionResult> {
  const { walletId, to, data, value, referenceId } = params;
  const sponsor = params.sponsor ?? true;

  const transaction: Record<string, string> = { to };
  if (data) transaction.data = data;
  if (value) transaction.value = value;

  const body: Record<string, unknown> = {
    method: "eth_sendTransaction",
    caip2: BASE_CAIP2,
    chain_type: "ethereum",
    params: { transaction },
  };
  if (sponsor) body.sponsor = true;
  if (referenceId) body.reference_id = referenceId;

  const response = await privyFetch(`/wallets/${walletId}/rpc`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new PrivyApiError(response.status, text);
  }

  const json = (await response.json()) as SendTransactionResponse;
  const result = json.data;
  if (!result?.transaction_id) {
    throw new PrivyApiError(500, `Malformed response: ${JSON.stringify(json)}`);
  }

  return {
    transactionId: result.transaction_id,
    userOperationHash: result.user_operation_hash ?? null,
    hash: result.hash ?? "",
  };
}

// ---------------------------------------------------------------------------
// GET /v1/transactions/{id}
// ---------------------------------------------------------------------------

export type PrivyTransactionStatus =
  | "pending"
  | "broadcasted"
  | "confirmed"
  | "finalized"
  | "execution_reverted"
  | "failed"
  | "replaced"
  | "provider_error";

export type PrivyTransactionTerminalStatus = Exclude<
  PrivyTransactionStatus,
  "pending" | "broadcasted"
>;

export type PrivyTransaction = {
  id: string;
  wallet_id: string;
  status: PrivyTransactionStatus;
  transaction_hash: string | null;
  user_operation_hash: string | null;
  caip2: string;
  sponsored?: boolean;
  reference_id?: string | null;
  created_at?: number;
};

/**
 * Fetch a Privy transaction by id. Used to resolve the final
 * `transaction_hash` for sponsored UserOps that return an empty `hash`
 * at broadcast time.
 */
export async function getTransaction(
  transactionId: string,
): Promise<PrivyTransaction> {
  const response = await privyFetch(`/transactions/${transactionId}`, {
    method: "GET",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new PrivyApiError(response.status, text);
  }

  return (await response.json()) as PrivyTransaction;
}

const TERMINAL_STATUSES: ReadonlySet<PrivyTransactionTerminalStatus> = new Set([
  "confirmed",
  "finalized",
  "execution_reverted",
  "failed",
  "replaced",
  "provider_error",
]);

const SUCCESS_STATUSES: ReadonlySet<PrivyTransactionTerminalStatus> = new Set([
  "confirmed",
  "finalized",
]);

/**
 * Poll Privy's transaction endpoint until it reaches a terminal state.
 *
 * - Success (`confirmed` | `finalized`) → resolves with the final
 *   `{ hash, status }`.
 * - Terminal failure → throws `PrivyTransactionFailedError`.
 * - Timeout → throws `PrivyTransactionTimeoutError`. Callers decide
 *   whether to surface the tx as "unknown" or retry later via the
 *   `transactionId`.
 *
 * Backoff: starts at 500ms and doubles to a 2s cap. Base mainnet
 * confirmation is typically 1–10s (per Privy's own transaction-handling
 * docs), so fast-first-polls materially cut user-visible spinner time
 * for the common case without hammering Privy across the long tail.
 *
 * RPC-consistency note: polling Privy (not our public Base RPC) is
 * the only way to avoid the preconf-vs-public lag #19 hit — the
 * public RPC trails the submission RPC by 2–30s for the sponsored
 * UserOp path.
 */
export async function waitForTransaction(
  transactionId: string,
  options: { timeoutMs?: number; initialPollMs?: number; maxPollMs?: number } = {},
): Promise<{ hash: string; status: PrivyTransactionTerminalStatus }> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const initialPollMs = options.initialPollMs ?? 500;
  const maxPollMs = options.maxPollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  let nextDelayMs = initialPollMs;
  while (Date.now() < deadline) {
    const tx = await getTransaction(transactionId);
    const status = tx.status as PrivyTransactionTerminalStatus;
    if (TERMINAL_STATUSES.has(status)) {
      if (SUCCESS_STATUSES.has(status) && tx.transaction_hash) {
        return { hash: tx.transaction_hash, status };
      }
      throw new PrivyTransactionFailedError(
        transactionId,
        status,
        tx.transaction_hash,
      );
    }
    await sleep(nextDelayMs);
    nextDelayMs = Math.min(nextDelayMs * 2, maxPollMs);
  }

  throw new PrivyTransactionTimeoutError(transactionId);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requireCredentials(): { appId: string; appSecret: string } {
  const appId = env.PRIVY_APP_ID;
  const appSecret = env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new PrivyNotConfiguredError();
  }
  return { appId, appSecret };
}

function privyFetch(path: string, init: RequestInit): Promise<Response> {
  const { appId, appSecret } = requireCredentials();
  const auth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Basic ${auth}`);
  headers.set("privy-app-id", appId);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(`${PRIVY_API_BASE}${path}`, { ...init, headers });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
