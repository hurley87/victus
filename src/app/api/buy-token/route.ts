import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import { createViemAccount } from '@privy-io/server-auth/viem';
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { tradeCoin } from '@zoralabs/coins-sdk';

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

    const tradeParams = {
      direction: 'sell' as const,
      target: '0xd89c4c827c152438a09294E7B299aD628c5aadD7' as `0x${string}`,
      args: {
        recipient:
          '0x6e8068F46082eDb44Ff1eE0D1570c8dC821281C3' as `0x${string}`,
        orderSize: parseUnits('0.0001', 18),
      },
    };

    console.log('tradeParams', tradeParams);

    const result = await tradeCoin(tradeParams, walletClient, publicClient);
    console.log(result);

    return NextResponse.json({
      buy: 'success',
    });
  } catch (e) {
    console.log('error', e);
    return NextResponse.json(
      { error: 'Failed to create wallet' },
      { status: 500 }
    );
  }
}
