import { NextResponse } from 'next/server';
import { createCoin } from '@zoralabs/coins-sdk';
import { getWalletClients } from '@/lib/clients';

export async function GET() {
  try {
    const { walletClient, publicClient } = await getWalletClients();

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
  } catch (error) {
    console.error('Error creating token:', error);
    return NextResponse.json(
      { error: 'Failed to create token' },
      { status: 500 }
    );
  }
}
