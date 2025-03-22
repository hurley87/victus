import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';

// It's best practice to initialize the Privy client outside the handler if it's reusable
const privy = new PrivyClient(
  process.env.PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!
);

export async function GET() {

  try {
    // Create a new custodial wallet on Ethereum
    const { id: walletId, address, chainType } = await privy.walletApi.create({
      chainType: 'ethereum',
    });

    return NextResponse.json({
      walletId,
      address,
      chainType,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to create wallet' }, { status: 500 });
  }
}