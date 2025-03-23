import { getSystemPrompt, getRoutePrompt } from '@/lib/prompts';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

export const runtime = 'edge';
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
});

export async function POST(request: Request) {
  try {
    const req = await request.json();
    // const uuid = process.env.SIGNER_UUID as string;
    const data = req.data;
    const text = data.text;
    const verifiedAddress = data.author.verified_addresses?.eth_addresses?.[0];

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

    return Response.json({ status: 'accepted' });
  } catch (error) {
    console.error('Error in enjoy-agent:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
