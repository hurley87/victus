import { getConversation } from '@/lib/neynar';
import { getActionPrompt } from '@/lib/prompts';
import { transformMessages } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { publishCast } from '@/lib/neynar';
import { CommodusResponse } from '@/lib/schemas';
import { BackgroundTaskData } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

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

/**
 * Handles CHAT action by publishing a direct response
 */
const handleChatAction = async (
  reply: string,
  parent: string
): Promise<Response> => {
  await publishCast(reply, parent);
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

export async function POST(request: NextRequest) {
  try {
    const req = await request.json();
    const data = req.data;
    const text = data.text;
    const threadHash = data.thread_hash;
    const parent = data.hash;
    const verifiedAddress = data.author?.verified_addresses?.eth_addresses?.[0];
    const score = data.author?.experimental?.neynar_user_score;
    console.log('score', score);
    const image = data.embeds?.[0]?.url;

    if (!text || !threadHash) {
      return NextResponse.json(
        {
          success: false,
          message: 'Missing required fields: text and thread_hash',
        },
        { status: 400 }
      );
    }

    const conversationMessages = await getConversation(threadHash);

    console.log('conversationMessages', conversationMessages);

    const openAIMessages = transformMessages(conversationMessages, text);

    console.log('openAIMessages', openAIMessages);

    const client = new OpenAI();
    const run = await client.beta.threads.createAndRunPoll({
      assistant_id: 'asst_YhRgpzqRTyNuGHsq7yRWOEtQ',
      thread: {
        messages: openAIMessages,
      },
      instructions: getActionPrompt(text),
      model: 'gpt-4o-mini',
      response_format: {
        type: 'json_object',
      },
    });

    const openAIThreadId = run.thread_id;
    const threadMessages = await client.beta.threads.messages.list(
      openAIThreadId
    );
    const lastMessage = threadMessages.data[0].content[0];

    // Clean up the thread
    await client.beta.threads.del(openAIThreadId);

    if (lastMessage.type !== 'text') {
      return NextResponse.json({
        success: false,
        message: 'Response contains non-text content',
      });
    }

    const agentRoute = JSON.parse(lastMessage.text.value) as CommodusResponse;
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

    if (score < 0.5) {
      const cast = await publishCast(
        'Your score is too low to enter my arena, citizen. Return when you have proven your worth!',
        parent
      );
      console.log('Published verification failure:', cast);
      return Response.json({ status: 'SCORE_TOO_LOW' });
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
    console.error('Error in test API route:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to generate response',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
