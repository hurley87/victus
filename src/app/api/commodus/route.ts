import { getSystemPrompt, getActionPrompt } from '@/lib/prompts';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { BackgroundTaskData } from '@/lib/types';
import { publishCast } from '@/lib/neynar';
import { CommodusResponse, commodusResponseSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

// ----- Background Task Handling -----

/**
 * Triggers a background task for async processing
 */
const triggerBackgroundTask = async (
  taskData: BackgroundTaskData
): Promise<boolean> => {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || 'https://www.victus.fun';
    const url = `${baseUrl}/api/commodus/task`;

    console.log('Triggering background task:', { url, taskData });

    // Fire-and-forget request
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

    return true;
  } catch (error) {
    console.error('Error triggering background task:', error);
    return false;
  }
};

// ----- Action Handlers -----

/**
 * Handles CHAT action by publishing a direct response
 */
const handleChatAction = async (
  reply: string,
  parent: string
): Promise<Response> => {
  const cast = await publishCast(reply, parent);
  console.log('Published chat cast:', cast);
  return Response.json({ status: 'CHAT' });
};

/**
 * Handles CREATE action for NFT creation
 */
const handleCreateAction = async (
  agentRoute: CommodusResponse,
  image: string,
  verifiedAddress: string,
  parent: string
): Promise<Response> => {
  if (!image) {
    const cast = await publishCast(
      '404 IMAGE NOT FOUND 😭 (pls include an image in your cast)',
      parent
    );
    console.log('Published error cast:', cast);
    return Response.json({ error: 'No image found' }, { status: 400 });
  }

  if (agentRoute.action !== 'CREATE') {
    return Response.json({ error: 'Invalid action type' }, { status: 400 });
  }

  // Trigger background task with necessary data
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
};

/**
 * Handles TRADE action for trading operations
 */
const handleTradeAction = async (
  agentRoute: CommodusResponse,
  verifiedAddress: string,
  parent: string
): Promise<Response> => {
  if (agentRoute.action !== 'TRADE') {
    return Response.json({ error: 'Invalid action type' }, { status: 400 });
  }

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
};

// ----- Main API Handler -----

export async function POST(request: Request): Promise<Response> {
  try {
    // Parse request
    const req = await request.json();
    const data = req.data;
    const text = data.text;
    const parent = data.hash;
    const verifiedAddress = data.author.verified_addresses?.eth_addresses?.[0];
    const image = data.embeds?.[0]?.url;

    // Generate AI response
    const { object: agentRoute } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: commodusResponseSchema,
      schemaName: 'EmperorResponse',
      schemaDescription: 'Response from Emperor Commodus about gladiators',
      mode: 'json',
      system: getSystemPrompt(),
      prompt: getActionPrompt(text),
    });

    console.log('Generated agent route:', agentRoute);

    // Handle CHAT actions immediately (no address verification needed)
    if (agentRoute.action === 'CHAT' && agentRoute.reply) {
      return handleChatAction(agentRoute.reply, parent);
    }

    // Verify address for other actions
    if (!verifiedAddress) {
      const cast = await publishCast('No verified address found', parent);
      console.log('Published address verification failure:', cast);
      return Response.json(
        { error: 'No verified address found' },
        { status: 400 }
      );
    }

    // Route to appropriate handler based on action type
    switch (agentRoute.action) {
      case 'CREATE':
        return handleCreateAction(agentRoute, image, verifiedAddress, parent);
      case 'TRADE':
        return handleTradeAction(agentRoute, verifiedAddress, parent);
      default:
        return Response.json({ status: agentRoute.action });
    }
  } catch (error) {
    console.error('Error in Commodus API route:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
