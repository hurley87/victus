/**
 * Smoke test for `lib/arena/withdraw.ts`. Dry-run first (read-only
 * checks), then optionally fires the real withdraw with `--execute`.
 *
 * Usage:
 *   pnpm tsx scripts/smoke-withdraw.ts           # dry-run
 *   pnpm tsx scripts/smoke-withdraw.ts --execute # real tx
 */

import { getAddress } from "viem";

import { USDC_BASE_ADDRESS } from "../lib/chain/addresses";
import { readUsdcBalance } from "../lib/chain/erc20";
import { supabaseAdmin } from "../lib/supabase/server";
import {
  getTransaction,
  PrivyNotConfiguredError,
} from "../lib/privy/server";
import { withdrawUsdc } from "../lib/arena/withdraw";

const HURLS_USER_ID = "f7482a22-4474-4bf7-9dbc-f0298ec89ce6";
const HURLS_FID = 7988;
const EXPECTED_ARENA = "0xa187e2eda00eca46fba1ca837487944e8954c23a";
const EXPECTED_PRIVY_ID = "odcoydp8bt86iglfug5v0gyb";

async function main() {
  const execute = process.argv.includes("--execute");

  console.log("— Supabase state —");
  const { data: wallet } = await supabaseAdmin
    .from("arena_wallets")
    .select("wallet_address, privy_wallet_id")
    .eq("user_id", HURLS_USER_ID)
    .maybeSingle();
  const { data: gladiator } = await supabaseAdmin
    .from("gladiators")
    .select("name, status")
    .eq("user_id", HURLS_USER_ID)
    .maybeSingle();
  const { data: fc } = await supabaseAdmin
    .from("farcaster_accounts")
    .select("verifications, username")
    .eq("user_id", HURLS_USER_ID)
    .maybeSingle();

  console.log({ wallet, gladiator, fc_username: fc?.username, verifications: fc?.verifications });

  if (wallet?.wallet_address?.toLowerCase() !== EXPECTED_ARENA) {
    throw new Error(`Arena address mismatch: ${wallet?.wallet_address}`);
  }
  if (wallet?.privy_wallet_id !== EXPECTED_PRIVY_ID) {
    throw new Error(`Privy wallet id mismatch: ${wallet?.privy_wallet_id}`);
  }
  if (gladiator?.status !== "alive") {
    throw new Error(`Gladiator not alive: ${gladiator?.status}`);
  }

  console.log("\n— On-chain balance (via public Base RPC) —");
  const balance = await readUsdcBalance(getAddress(EXPECTED_ARENA));
  console.log(`${EXPECTED_ARENA} USDC: ${balance}`);
  if (balance <= 0) {
    throw new Error("Expected a positive USDC balance for this smoke test");
  }

  console.log("\n— Privy credential probe —");
  try {
    await getTransaction("__probe__");
    console.log("Privy creds work (404 expected on a fake id — see below)");
  } catch (err) {
    if (err instanceof PrivyNotConfiguredError) {
      throw new Error("PRIVY_APP_ID / PRIVY_APP_SECRET not set in env");
    }
    // Any other error (404 for the fake id, 400 malformed) means auth
    // works; we're just probing credentials.
    console.log(
      `Privy probe returned expected error (auth succeeded): ${
        err instanceof Error ? err.message.slice(0, 120) : String(err)
      }`,
    );
  }

  console.log("\nUSDC token:", USDC_BASE_ADDRESS);

  if (!execute) {
    console.log("\nDry-run complete. Re-run with --execute to send the real tx.");
    return;
  }

  console.log("\n— Executing real withdraw —");
  const result = await withdrawUsdc({
    userId: HURLS_USER_ID,
    fid: HURLS_FID,
  });
  console.log("Result:", result);

  const after = await readUsdcBalance(getAddress(EXPECTED_ARENA));
  console.log(`\nArena USDC after: ${after}`);
}

main().catch((err) => {
  console.error("smoke-withdraw failed:", err);
  process.exit(1);
});
