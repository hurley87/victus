import { getSystemPrompt, getRoutePrompt } from '@/lib/prompts';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { getWalletClients } from '@/lib/clients';
import { createCoin } from '@zoralabs/coins-sdk';
import pinataSDK from '@pinata/sdk';

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

const publishCast = async (text: string, parent: string) => {
  const signerUuid = process.env.SIGNER_UUID as string;
  const response = await neynarClient.publishCast({
    signerUuid,
    text,
    parent,
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

export async function POST(request: Request) {
  try {
    const req = await request.json();
    const { walletClient, publicClient } = await getWalletClients();

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
      prompt: getRoutePrompt(text),
    });

    console.log('agentRoute', agentRoute);

    // Always publish the reply regardless of action type
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
    // Handle specific actions
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

      const uri = await pinMetadataToIPFS(
        agentRoute.name,
        agentRoute.description,
        image
      );

      const createCoinParams = {
        name: agentRoute.name,
        symbol: agentRoute.symbol,
        uri,
        payoutRecipient: verifiedAddress as `0x${string}`,
        platformReferrer:
          '0xbD78783a26252bAf756e22f0DE764dfDcDa7733c' as `0x${string}`,
      };

      console.log('createCoinParams', createCoinParams);

      const result = await createCoin(
        createCoinParams,
        walletClient,
        publicClient
      );

      console.log(result);

      const tokenAddress = result.address;

      console.log('tokenAddress', tokenAddress);

      const cast = await publishCast(
        `${agentRoute.reply}\n\nhttps://zora.co/coin/base:${tokenAddress}`,
        parent
      );
      console.log('cast', cast);

      return Response.json({ status: 'CREATE' });
    } else if (agentRoute.action === 'TRADE') {
      // Additional TRADE action processing could go here
      // Call the buy-token or sell-token API based on direction
      return Response.json({ status: 'TRADE' });
    }

    return Response.json({ status: agentRoute.action });
  } catch (error) {
    console.error('Error in enjoy-agent:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
