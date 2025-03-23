import { getSystemPrompt, getActionPrompt } from '@/lib/prompts';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { BackgroundTaskData } from '@/lib/types';
import { publishCast } from '@/lib/neynar';
import { commodusResponseSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes, adjust as needed

// Trigger the background task
const triggerBackgroundTask = async (taskData: BackgroundTaskData) => {
  try {
    // Use server base URL with fallback
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || 'https://www.victus.fun';
    const url = `${baseUrl}/api/commodus/task`;

    console.log('Triggering background task:', { url, taskData });

    // Fire-and-forget
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.BACKGROUND_TASK_SECRET || 'secret-key',
      },
      body: JSON.stringify(taskData),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(
        `Background task request failed: ${response.status}`,
        errorData
      );
      return false;
    }

    console.log('Background task triggered successfully');
    return true;
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

    const { object: agentRoute } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: commodusResponseSchema,
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
