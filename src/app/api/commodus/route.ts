import { getSystemPrompt, getRoutePrompt } from '@/lib/prompts';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
// import pinataSDK from '@pinata/sdk';

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
// const pinata = new pinataSDK({ pinataJWTKey: process.env.PINATA_JWT_KEY });
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
      prompt: getRoutePrompt(text),
    });

    console.log('agentRoute', agentRoute);

    // Always publish the reply regardless of action type
    if (agentRoute?.reply) {
      const cast = await publishCast(agentRoute.reply, parent);
      console.log('cast', cast);
    }

    // Handle specific actions
    if (agentRoute.action === 'CREATE') {
      // Additional CREATE action processing could go here
      // Call the create-token API or directly create the token
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
