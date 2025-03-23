import { NextResponse } from 'next/server';
import { parseUnits } from 'viem';
import { tradeCoin } from '@zoralabs/coins-sdk';
import { getWalletClients } from '@/lib/clients';

export async function GET() {
  try {
    const { walletClient, publicClient } = await getWalletClients();

    const tradeParams = {
      direction: 'buy' as const,
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
