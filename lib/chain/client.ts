import "server-only";

import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

import { env } from "@/lib/env";

/**
 * Single shared viem public client for Base mainnet.
 *
 * Used for read-only on-chain queries: arena-wallet balances (USDC +
 * held positions) rendered on the Arena page, and — post-#19 — swap-log
 * decoding in the execution pipeline.
 *
 * We rely on type inference rather than a `PublicClient` annotation:
 * viem's OpStack-aware `base` chain returns a client whose block type
 * includes deposit transactions, which is incompatible with the
 * generic `PublicClient<Transport, Chain | undefined>` type.
 */
export const basePublicClient = createPublicClient({
  chain: base,
  transport: http(env.BASE_RPC_URL),
});
