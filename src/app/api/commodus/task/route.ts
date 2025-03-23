import { getWalletClients } from '@/lib/clients';
import { createCoin, tradeCoin } from '@zoralabs/coins-sdk';
import pinataSDK from '@pinata/sdk';
import { parseUnits } from 'viem';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { BackgroundTaskData } from '@/lib/types';

// Configure for long-running tasks
export const maxDuration = 300; // 5 minutes timeout
export const dynamic = 'force-dynamic';

// Initialize clients
const pinata = new pinataSDK({ pinataJWTKey: process.env.PINATA_JWT_KEY });
const neynarClient = new NeynarAPIClient({
  apiKey: process.env.NEYNAR_API_KEY as string,
});

const publishCast = async (text: string, parent: string, url?: string) => {
  const signerUuid = process.env.SIGNER_UUID as string;
  const response = await neynarClient.publishCast({
    signerUuid,
    text,
    parent,
    embeds: url ? [{ url }] : undefined,
  });
  return response;
};

const pinMetadataToIPFS = async (
  name: string,
  description: string,
  image: string
) => {
  const metadata = {
    name,
    description,
    image,
  };
  try {
    const pinataRes = await pinata.pinJSONToIPFS(metadata);
    console.log('Pinata response:', pinataRes);
    return `https://amber-late-bug-27.mypinata.cloud/ipfs/${pinataRes.IpfsHash}`;
  } catch (error) {
    console.error('Error pinning to IPFS:', error);
    throw new Error('Failed to pin metadata to IPFS');
  }
};

// Handle CREATE task
const handleCreateCoin = async (taskData: BackgroundTaskData) => {
  if (taskData.type !== 'CREATE') {
    throw new Error('Invalid task type for CREATE operation');
  }

  try {
    // Pin metadata to IPFS
    const uri = await pinMetadataToIPFS(
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
      platformReferrer:
        '0xbD78783a26252bAf756e22f0DE764dfDcDa7733c' as `0x${string}`,
    };

    const result = await createCoin(
      createCoinParams,
      walletClient,
      publicClient
    );

    const tokenAddress = result.address;

    // Publish the final response with the token address
    await publishCast(
      taskData.reply,
      taskData.parent,
      `https://zora.co/coin/base:${tokenAddress}`
    );

    console.log('CREATE operation completed successfully');
    return { success: true, tokenAddress };
  } catch (error) {
    console.error('Error in CREATE task:', error);

    // Notify about the error
    await publishCast(
      `Failed to create coin: ${(error as Error).message}`,
      taskData.parent
    );
    return { success: false, error: (error as Error).message };
  }
};

// Handle TRADE task
const handleTrade = async (taskData: BackgroundTaskData) => {
  if (taskData.type !== 'TRADE') {
    throw new Error('Invalid task type for TRADE operation');
  }

  try {
    // Get wallet clients
    const { walletClient, publicClient } = await getWalletClients();

    // Create trade parameters
    const params = {
      direction: taskData.direction.toLowerCase() as 'buy' | 'sell',
      target: taskData.tokenAddress as `0x${string}`,
      args: {
        recipient: taskData.verifiedAddress as `0x${string}`,
        orderSize: parseUnits(taskData.size, 18), // Assuming 18 decimals for the token
      },
    };

    console.log('params', params);

    // Execute the trade
    const tradeResult = await tradeCoin(params, walletClient, publicClient);

    // Publish a reply with the transaction result
    const tradeUrl = `https://basescan.org/tx/${tradeResult.hash}`;
    const tradeMessage = `${taskData.reply}\n\nTransaction: ${tradeUrl}`;

    console.log('tradeMessage', tradeMessage);
    console.log('tradeUrl', tradeUrl);

    await publishCast(tradeMessage, taskData.parent);

    console.log('TRADE operation completed successfully');
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
};

export async function POST(request: Request) {
  try {
    // Validate API key for secure access
    const apiKey = request.headers.get('x-api-key');
    if (apiKey !== (process.env.BACKGROUND_TASK_SECRET || 'secret-key')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const taskData = await request.json();
    console.log('Processing background task:', taskData.type);

    let result;
    // Process different task types
    if (taskData.type === 'CREATE') {
      result = await handleCreateCoin(taskData);
    } else if (taskData.type === 'TRADE') {
      result = await handleTrade(taskData);
    } else {
      return Response.json({ error: 'Invalid task type' }, { status: 400 });
    }

    return Response.json({ success: true, result });
  } catch (error) {
    console.error('Error processing background task:', error);
    return Response.json(
      { error: 'Failed to process task', details: (error as Error).message },
      { status: 500 }
    );
  }
}
