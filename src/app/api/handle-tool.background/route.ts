import { getWalletClients } from '@/lib/clients';
import { createCoin, tradeCoin } from '@zoralabs/coins-sdk';
import { parseUnits } from 'viem';
import { publishCast } from '@/lib/neynar';
import { ipfsService } from '@/lib/ipfs';
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';

// Constants
const PLATFORM_REFERRER = '0xbD78783a26252bAf756e22f0DE764dfDcDa7733c' as const;

// Types
type CreateTaskData = {
  name: string;
  description: string;
  image: string;
  symbol: string;
  parent: string;
  reply: string;
  verifiedAddress: string;
};

type TradeTaskData = {
  direction: 'BUY' | 'SELL';
  tokenAddress: string;
  size: string;
  parent: string;
  reply: string;
  verifiedAddress: string;
};

type TaskResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

// Schemas
const createTaskSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  image: z.string().url(),
  symbol: z.string().min(1),
  parent: z.string().min(1),
  verifiedAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const tradeTaskSchema = z.object({
  direction: z.enum(['BUY', 'SELL']),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  size: z.string().min(1),
  parent: z.string().min(1),
  verifiedAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

// Task handlers
const taskHandlers = {
  async handleCreate(
    taskData: CreateTaskData
  ): Promise<TaskResponse<{ coinAddress: string }>> {
    try {
      // Validate input
      const validatedData = createTaskSchema.parse(taskData);

      // Pin metadata to IPFS
      const uri = await ipfsService.pinMetadata(
        validatedData.name,
        validatedData.description,
        validatedData.image
      );

      // Get wallet clients
      const { walletClient, publicClient } = await getWalletClients();

      // Create coin
      const createCoinParams = {
        name: validatedData.name,
        symbol: validatedData.symbol,
        uri,
        payoutRecipient: validatedData.verifiedAddress as `0x${string}`,
        platformReferrer: PLATFORM_REFERRER,
      };

      const coin = await createCoin(
        createCoinParams,
        walletClient,
        publicClient
      );
      await publicClient.waitForTransactionReceipt({ hash: coin.hash });

      if (!coin.address) {
        throw new Error('Coin address not found in response');
      }

      return {
        success: true,
        data: { coinAddress: coin.address },
      };
    } catch (error) {
      console.error('Error in CREATE task:', error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },

  async handleTrade(
    taskData: TradeTaskData
  ): Promise<TaskResponse<{ tradeUrl: string }>> {
    try {
      // Validate input
      const validatedData = tradeTaskSchema.parse(taskData);

      // Get wallet clients
      const { walletClient, publicClient } = await getWalletClients();

      // Create trade parameters
      const params = {
        direction: validatedData.direction.toLowerCase() as 'buy' | 'sell',
        target: validatedData.tokenAddress as `0x${string}`,
        platformReferrer: PLATFORM_REFERRER,
        args: {
          recipient: validatedData.verifiedAddress as `0x${string}`,
          orderSize: parseUnits(validatedData.size, 18),
        },
      };

      // Execute the trade
      const tradeResult = await tradeCoin(params, walletClient, publicClient);
      const tradeUrl = `https://basescan.org/tx/${tradeResult.hash}`;

      return {
        success: true,
        data: { tradeUrl },
      };
    } catch (error) {
      console.error('Error in TRADE task:', error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
};

// OpenAI client wrapper
const openai = new OpenAI();

const submitToolOutput = async (
  runId: string,
  threadId: string,
  toolCallId: string,
  output: string
): Promise<void> => {
  try {
    await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
      tool_outputs: [{ tool_call_id: toolCallId, output }],
    });
  } catch (error) {
    console.error('Error submitting tool output:', error);
    throw new Error('Failed to submit tool output');
  }
};

// Route configuration
export const dynamic = 'force-dynamic';

// Main API route handler
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      toolCallId,
      runId,
      threadId,
      toolName,
      args,
      parent,
      verifiedAddress,
    } = body;

    let result: TaskResponse<{ coinAddress: string } | { tradeUrl: string }>;

    switch (toolName) {
      case 'create_token':
        result = await taskHandlers.handleCreate({
          ...args,
          parent,
          verifiedAddress,
        });
        if (result.success && result.data && 'coinAddress' in result.data) {
          await publishCast(
            `Coin created! ${args.name} (${args.symbol})`,
            parent,
            `https://zora.co/coin/base:${result.data.coinAddress}`
          );
        }
        break;

      case 'trade_token':
        result = await taskHandlers.handleTrade({
          ...args,
          parent,
          verifiedAddress,
        });
        if (result.success && result.data && 'tradeUrl' in result.data) {
          await publishCast(`Coin traded! ${result.data.tradeUrl}`, parent);
        }
        break;

      default:
        throw new Error(`Unsupported tool: ${toolName}`);
    }

    await submitToolOutput(runId, threadId, toolCallId, JSON.stringify(result));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing background task:', error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to process task',
      },
      { status: 500 }
    );
  }
}
