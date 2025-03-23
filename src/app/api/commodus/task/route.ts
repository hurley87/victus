import { getWalletClients } from '@/lib/clients';
import { createCoin, tradeCoin } from '@zoralabs/coins-sdk';
import { parseUnits } from 'viem';
import { BackgroundTaskData } from '@/lib/types';
import { publishCast } from '@/lib/neynar';
import { ipfsService } from '@/lib/ipfs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 300; // 5 minutes timeout
export const dynamic = 'force-dynamic';

const apiKeySchema = z.string().min(1);

const PLATFORM_REFERRER = '0xbD78783a26252bAf756e22f0DE764dfDcDa7733c' as const;

// Task handler service
const taskHandlers = {
  /**
   * Handles CREATE coin operations
   */
  async handleCreateCoin(
    taskData: Extract<BackgroundTaskData, { type: 'CREATE' }>
  ): Promise<{
    success: boolean;
    coinAddress?: string;
    error?: string;
  }> {
    try {
      // Pin metadata to IPFS
      const uri = await ipfsService.pinMetadata(
        taskData.name,
        taskData.description,
        taskData.image
      );

      // Get wallet clients
      const { walletClient, publicClient } = await getWalletClients();

      // Create coin
      const createCoinParams = {
        name: taskData.name,
        symbol: taskData.symbol,
        uri,
        payoutRecipient: taskData.verifiedAddress as `0x${string}`,
        platformReferrer: PLATFORM_REFERRER,
      };

      const coin = await createCoin(
        createCoinParams,
        walletClient,
        publicClient
      );
      const hash = coin.hash;

      await publicClient.waitForTransactionReceipt({ hash });
      const coinAddress = coin.address;

      // Publish the final response with the token address
      await publishCast(
        taskData.reply,
        taskData.parent,
        `https://zora.co/coin/base:${coinAddress}`
      );

      return { success: true, coinAddress };
    } catch (error) {
      console.error('Error in CREATE task:', error);

      // Notify about the error
      await publishCast(
        `Failed to create coin: ${(error as Error).message}`,
        taskData.parent
      );

      return { success: false, error: (error as Error).message };
    }
  },

  /**
   * Handles TRADE operations (buy/sell)
   */
  async handleTrade(
    taskData: Extract<BackgroundTaskData, { type: 'TRADE' }>
  ): Promise<{
    success: boolean;
    txHash?: string;
    error?: string;
  }> {
    try {
      // Get wallet clients
      const { walletClient, publicClient } = await getWalletClients();

      // Create trade parameters
      const params = {
        direction: taskData.direction.toLowerCase() as 'buy' | 'sell',
        target: taskData.tokenAddress as `0x${string}`,
        platformReferrer: PLATFORM_REFERRER,
        args: {
          recipient: taskData.verifiedAddress as `0x${string}`,
          orderSize: parseUnits(taskData.size, 18), // Assuming 18 decimals for the token
        },
      };

      // Execute the trade
      const tradeResult = await tradeCoin(params, walletClient, publicClient);

      // Publish a reply with the transaction result
      const tradeUrl = `https://basescan.org/tx/${tradeResult.hash}`;
      const tradeMessage = `${taskData.reply}\n\nTransaction: ${tradeUrl}`;

      await publishCast(tradeMessage, taskData.parent);

      return { success: true, txHash: tradeResult.hash };
    } catch (error) {
      console.error('Error in TRADE task:', error);

      // Notify about the error
      await publishCast(
        `Failed to ${taskData.direction.toLowerCase()} token: ${
          (error as Error).message
        }`,
        taskData.parent
      );

      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Authenticates the API request
 */
function authenticateRequest(request: Request): boolean {
  try {
    const apiKey = request.headers.get('x-api-key');
    apiKeySchema.parse(apiKey);

    return apiKey === (process.env.BACKGROUND_TASK_SECRET || 'secret-key');
  } catch {
    return false;
  }
}

/**
 * Main API route handler for POST requests
 */
export async function POST(request: Request) {
  try {
    // Validate API key for secure access
    if (!authenticateRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and process the task data
    const taskData = (await request.json()) as BackgroundTaskData;

    // Process different task types
    let result;

    if (taskData.type === 'CREATE') {
      result = await taskHandlers.handleCreateCoin(taskData);
    } else if (taskData.type === 'TRADE') {
      result = await taskHandlers.handleTrade(taskData);
    } else {
      return NextResponse.json({ error: 'Invalid task type' }, { status: 400 });
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Error processing background task:', error);

    return NextResponse.json(
      {
        error: 'Failed to process task',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
