import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createViemAccount } from '@privy-io/server-auth/viem';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { base } from 'viem/chains';
import { createCoin } from '@zoralabs/coins-sdk';

// It's best practice to initialize the Privy client outside the handler if it's reusable
const privy = new PrivyClient(
  process.env.PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!
);

export async function GET() {
  try {
    // Create a new custodial wallet on Ethereum
    // Create a viem account instance for a wallet
    const account = await createViemAccount({
      walletId: 'k12xh985fc59b5u7svln692a',
      address: '0x6e8068F46082eDb44Ff1eE0D1570c8dC821281C3',
      privy,
    });

    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(),
    });

    const publicClient = createPublicClient({
      chain: base,
      transport: http(),
    }) as any;

    console.log('account', account);

    const createCoinParams = {
      name: 'Arrows TEST',
      symbol: 'ARROWS',
      uri: 'https://pink-changing-earwig-765.mypinata.cloud/ipfs/bafkreifpjmf5m4n77e3cx5gsaxmqdtjfbg4na3ftwvfvvvd3ezwb6nsbky',
      payoutRecipient:
        '0x6e8068F46082eDb44Ff1eE0D1570c8dC821281C3' as `0x${string}`,
    };

    const result = await createCoin(
      createCoinParams,
      walletClient,
      publicClient
    );

    console.log(result);

    const tokenAddress = result.address;

    console.log('tokenAddress', tokenAddress);

    return NextResponse.json({
      tokenAddress,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create wallet' },
      { status: 500 }
    );
  }
}
