import { getSystemPrompt, getActionPrompt } from '@/lib/prompts';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { getWalletClients } from '@/lib/clients';
import { createCoin, tradeCoin } from '@zoralabs/coins-sdk';
import pinataSDK from '@pinata/sdk';
import { parseUnits } from 'viem';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes, adjust as needed

// Define schemas based on action type
const baseSchema = z.object({
  text: z.string(),
  action: z.enum(['CHAT', 'CREATE', 'TRADE']),
  reply: z.string(),
});

const chatSchema = baseSchema.extend({
  action: z.literal('CHAT'),
});

const createSchema = baseSchema.extend({
  action: z.literal('CREATE'),
  name: z.string(),
  symbol: z.string(),
  description: z.string(),
});

const tradeSchema = baseSchema.extend({
  action: z.literal('TRADE'),
  tokenAddress: z.string(),
  size: z.string(),
  direction: z.enum(['BUY', 'SELL']),
});

// Combined schema with discriminated union
const schema = z.discriminatedUnion('action', [
  chatSchema,
  createSchema,
  tradeSchema,
]);

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

// Handle background tasks
const handleCreateCoinInBackground = async (createParams: {
  name: string;
  symbol: string;
  description: string;
  image: string;
  verifiedAddress: string;
  reply: string;
  parent: string;
}) => {
  try {
    // First, publish an acknowledgment
    await publishCast(
      `Your request to create ${createParams.name} (${createParams.symbol}) coin is being processed...`,
      createParams.parent
    );

    // Pin metadata to IPFS
    const uri = await pinMetadataToIPFS(
      createParams.name,
      createParams.description,
      createParams.image
    );

    // Get wallet clients
    const { walletClient, publicClient } = await getWalletClients();

    // Create coin
    const createCoinParams = {
      name: createParams.name,
      symbol: createParams.symbol,
      uri,
      payoutRecipient: createParams.verifiedAddress as `0x${string}`,
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
      createParams.reply,
      createParams.parent,
      `https://zora.co/coin/base:${tokenAddress}`
    );

    console.log('CREATE operation completed successfully');
  } catch (error) {
    console.error('Error in background CREATE task:', error);

    // Notify about the error
    await publishCast(
      `Failed to create coin: ${(error as Error).message}`,
      createParams.parent
    );
  }
};

const handleTradeInBackground = async (tradeParams: {
  tokenAddress: string;
  size: string;
  direction: 'BUY' | 'SELL';
  verifiedAddress: string;
  reply: string;
  parent: string;
}) => {
  try {
    // First, publish an acknowledgment
    await publishCast(
      `Your request to ${tradeParams.direction.toLowerCase()} ${
        tradeParams.size
      } tokens is being processed...`,
      tradeParams.parent
    );

    // Get wallet clients
    const { walletClient, publicClient } = await getWalletClients();

    // Create trade parameters
    const params = {
      direction: tradeParams.direction.toLowerCase() as 'buy' | 'sell',
      target: tradeParams.tokenAddress as `0x${string}`,
      args: {
        recipient: tradeParams.verifiedAddress as `0x${string}`,
        orderSize: parseUnits(tradeParams.size, 18), // Assuming 18 decimals for the token
      },
    };

    console.log('params', params);

    // Execute the trade
    const tradeResult = await tradeCoin(params, walletClient, publicClient);

    // Publish a reply with the transaction result
    const tradeUrl = `https://basescan.org/tx/${tradeResult.hash}`;
    const tradeMessage = `${tradeParams.reply}\n\nTransaction: ${tradeUrl}`;

    console.log('tradeMessage', tradeMessage);
    console.log('tradeUrl', tradeUrl);

    await publishCast(tradeMessage, tradeParams.parent);

    console.log('TRADE operation completed successfully');
  } catch (error) {
    console.error('Error in background TRADE task:', error);

    // Notify about the error
    await publishCast(
      `Failed to ${tradeParams.direction.toLowerCase()} token: ${
        (error as Error).message
      }`,
      tradeParams.parent
    );
  }
};

export async function POST(request: Request) {
  try {
    const req = await request.json();

    const data = req.data;
    const text = data.text;
    const verifiedAddress = data.author.verified_addresses?.eth_addresses?.[0];
    const parent = data.hash;

    console.log('data', data);
    console.log('text', text);
    console.log('verifiedAddress:', verifiedAddress);

    const { object: agentRoute } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema,
      schemaName: 'EmperorResponse',
      schemaDescription: 'Response from Emperor Commodus about gladiators',
      mode: 'json',
      system: getSystemPrompt(),
      prompt: getActionPrompt(text),
    });

    console.log('agentRoute', agentRoute);

    // Handle CHAT action immediately
    if (agentRoute.action === 'CHAT' && agentRoute?.reply) {
      const cast = await publishCast(agentRoute.reply, parent);
      console.log('cast', cast);
      return Response.json({ status: 'CHAT' });
    }

    if (!verifiedAddress) {
      const cast = await publishCast('No verified address found', parent);
      console.log('cast', cast);
      return Response.json(
        { error: 'No verified address found' },
        { status: 400 }
      );
    }

    // Handle CREATE action
    if (agentRoute.action === 'CREATE') {
      const image = data?.embeds?.[0]?.url;
      if (!image) {
        const cast = await publishCast(
          '404 IMAGE NOT FOUND 😭 (pls include an image in your cast)',
          parent
        );
        console.log('cast', cast);
        return Response.json({ error: 'No image found' }, { status: 400 });
      }

      // Process coin creation in background
      // Note: Using Promise without await to not block the response
      Promise.resolve().then(() =>
        handleCreateCoinInBackground({
          name: agentRoute.name,
          symbol: agentRoute.symbol,
          description: agentRoute.description,
          image,
          verifiedAddress,
          reply: agentRoute.reply,
          parent,
        })
      );

      return Response.json({ status: 'CREATE_PENDING' });
    }
    // Handle TRADE action
    else if (agentRoute.action === 'TRADE') {
      // Process trade in background
      // Note: Using Promise without await to not block the response
      Promise.resolve().then(() =>
        handleTradeInBackground({
          tokenAddress: agentRoute.tokenAddress,
          size: agentRoute.size,
          direction: agentRoute.direction,
          verifiedAddress,
          reply: agentRoute.reply,
          parent,
        })
      );

      return Response.json({ status: 'TRADE_PENDING' });
    }

    return Response.json({ status: agentRoute.action });
  } catch (error) {
    console.error('Error in enjoy-agent:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
