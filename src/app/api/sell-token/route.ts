import { NextResponse } from 'next/server';
import { parseUnits } from 'viem';
import type { PublicClient, WalletClient } from 'viem';
import { getWalletClients } from '@/utils/wallet/clients';
import { tradeCoin } from '@zoralabs/coins-sdk';
import type { TradeParams } from '@zoralabs/coins-sdk';

// Type definitions
type TradeResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
};

// BigInt serializer to convert BigInt to string
function serializeBigInt(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'bigint') {
    return data.toString();
  }

  if (Array.isArray(data)) {
    return data.map(serializeBigInt);
  }

  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        result[key] = serializeBigInt(data[key]);
      }
    }
    return result;
  }

  return data;
}

// Trade execution logic
async function executeTrade(
  walletClient: WalletClient,
  publicClient: PublicClient,
  orderSize: string,
  recipientAddress: `0x${string}`,
  targetAddress: `0x${string}`
): Promise<TradeResponse> {
  try {
    const tradeParams: TradeParams = {
      direction: 'sell',
      target: targetAddress,
      args: {
        recipient: recipientAddress,
        orderSize: parseUnits(orderSize, 18),
      },
    };

    const result = await tradeCoin(tradeParams, walletClient, publicClient);
    return { success: true, data: result };
  } catch (error) {
    console.error('Trade execution failed:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error during trade execution',
    };
  }
}

export async function GET() {
  try {
    // Constants - could be moved to environment variables or parameters
    const TARGET_ADDRESS =
      '0xd89c4c827c152438a09294E7B299aD628c5aadD7' as `0x${string}`;
    const WALLET_ADDRESS =
      '0x6e8068F46082eDb44Ff1eE0D1570c8dC821281C3' as `0x${string}`;
    const ORDER_SIZE = '444';

    // Initialize clients using the utility functions
    const { walletClient, publicClient } = await getWalletClients();

    // Execute trade
    const tradeResult = await executeTrade(
      walletClient,
      publicClient,
      ORDER_SIZE,
      WALLET_ADDRESS,
      TARGET_ADDRESS
    );

    if (!tradeResult.success) {
      return NextResponse.json(
        { error: tradeResult.error || 'Trade failed' },
        { status: 400 }
      );
    }

    // Serialize any BigInt values before returning the response
    const serializedData = serializeBigInt(tradeResult.data);

    return NextResponse.json({
      success: true,
      message: 'Token sold successfully',
      data: serializedData,
    });
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to process request',
      },
      { status: 500 }
    );
  }
}
