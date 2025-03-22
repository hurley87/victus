import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';
import {createViemAccount} from '@privy-io/server-auth/viem';
import {createWalletClient, http, parseEther} from 'viem';
import {base} from 'viem/chains';

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
        privy
    });  
    
    const client = createWalletClient({
        account,
        chain: base,
        transport: http()
    });

    console.log('account', account);

    const hash = await client.sendTransaction({
        to: '0xBe523e724B9Ea7D618dD093f14618D90c4B19b0c',
        value: parseEther('0.0001')
      });

    console.log('hash', hash);

    return NextResponse.json({
      hash,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to create wallet' }, { status: 500 });
  }
}