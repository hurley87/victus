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
    transport: http(),
  });
}

// Create a public client
export function getPublicClient(): PublicClient<Transport, Chain> {
  return createPublicClient({
    chain: base,
    transport: http(),
  }) as PublicClient<Transport, Chain>;
}

// Get all clients needed for transactions in one call
export async function getWalletClients(): Promise<{
  account: Account;
  walletClient: WalletClient;
  publicClient: PublicClient<Transport, Chain>;
}> {
  const walletId = 'k12xh985fc59b5u7svln692a';
  const address = '0x6e8068F46082eDb44Ff1eE0D1570c8dC821281C3';
  const account = await getWalletAccount(walletId, address);
  const walletClient = createClientForWallet(account);
  const publicClient = getPublicClient();

  return {
    account,
    walletClient,
    publicClient,
  };
}
