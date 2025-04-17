import { PrivyClient } from '@privy-io/server-auth';
import { createViemAccount } from '@privy-io/server-auth/viem';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type Transport,
  type PublicClient,
  type WalletClient,
  type Account,
} from 'viem';
import { base } from 'viem/chains';

// Initialize the Privy client
export const privy = new PrivyClient(
  process.env.PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!
);

const rpcUrl = process.env.RPC_URL!;

// Create a viem account instance for a wallet
export async function getWalletAccount(
  walletId: string,
  address: `0x${string}`
): Promise<Account> {
  return createViemAccount({
    walletId,
    address,
    privy,
  });
}

// Create a wallet client with the provided account
export function createClientForWallet(account: Account): WalletClient {
  return createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  });
}

// Create a public client
export function getPublicClient(): PublicClient<Transport, Chain> {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  }) as PublicClient<Transport, Chain>;
}

// Get all clients needed for transactions in one call
export async function getWalletClients(): Promise<{
  account: Account;
  walletClient: WalletClient;
  publicClient: PublicClient<Transport, Chain>;
}> {
  const walletId = 'mk9fuid4a267gfcwq9rlp9fn';
  const address = '0x85F0337c410D6179B7dC8c3E0e329483a89C3c6B';
  const account = await getWalletAccount(walletId, address);
  const walletClient = createClientForWallet(account);
  const publicClient = getPublicClient();

  return {
    account,
    walletClient,
    publicClient,
  };
}
