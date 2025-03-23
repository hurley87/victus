import { getSystemPrompt, getRoutePrompt } from '@/lib/prompts';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
// import pinataSDK from '@pinata/sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes, adjust as needed

const schema = z.object({
  text: z.string(),
  action: z.enum(['CHAT', 'CREATE', 'TRADE']),
  name: z.string().optional(),
  symbol: z.string().optional(),
  description: z.string().optional(),
  tokenAddress: z.string().optional(),
  size: z.string().optional(),
  direction: z.enum(['BUY', 'SELL']).optional(),
  reply: z.string().optional(),
});

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
      system: getSystemPrompt(),
      prompt: getRoutePrompt(text),
    });

    console.log('agentRoute', agentRoute);

    if (agentRoute.action === 'CHAT') {
      const cast = await publishCast(agentRoute.text, parent);
      console.log('cast', cast);
      return Response.json({ status: 'CHAT' });
    }

    return Response.json({ status: 'accepted' });
  } catch (error) {
    console.error('Error in enjoy-agent:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
