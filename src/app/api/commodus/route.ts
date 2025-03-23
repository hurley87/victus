import { getSystemPrompt, getActionPrompt } from '@/lib/prompts';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { BackgroundTaskData } from '@/lib/types';

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

// Trigger the background task
const triggerBackgroundTask = async (taskData: BackgroundTaskData) => {
  try {
    // Use server base URL with fallback
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    const url = `${baseUrl}/api/commodus/task`;

    // Fire-and-forget
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.BACKGROUND_TASK_SECRET || 'secret-key',
      },
      body: JSON.stringify(taskData),
    }).catch((error) => {
      console.error('Background task request failed:', error);
    });

    return true; // Return immediately while task processes in background
  } catch (error) {
    console.error('Error triggering background task:', error);
    return false;
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

      // Send immediate acknowledgment message
      await publishCast(
        `I'll create ${agentRoute.name} (${agentRoute.symbol}) coin for you. Processing...`,
        parent
      );

      // Trigger background task with all necessary data
      await triggerBackgroundTask({
        type: 'CREATE',
        name: agentRoute.name,
        symbol: agentRoute.symbol,
        description: agentRoute.description,
        image,
        verifiedAddress,
        reply: agentRoute.reply,
        parent,
      });

      return Response.json({ status: 'CREATE_PENDING' });
    }
    // Handle TRADE action
    else if (agentRoute.action === 'TRADE') {
      // Send immediate acknowledgment message
      await publishCast(
        `I'll ${agentRoute.direction.toLowerCase()} ${
          agentRoute.size
        } tokens for you. Processing...`,
        parent
      );

      // Trigger background task
      await triggerBackgroundTask({
        type: 'TRADE',
        tokenAddress: agentRoute.tokenAddress,
        size: agentRoute.size,
        direction: agentRoute.direction,
        verifiedAddress,
        reply: agentRoute.reply,
        parent,
      });

      return Response.json({ status: 'TRADE_PENDING' });
    }

    return Response.json({ status: agentRoute.action });
  } catch (error) {
    console.error('Error in enjoy-agent:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
