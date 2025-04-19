import { publishCast } from '@/lib/neynar';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Types
interface CommodusRequest {
  data: {
    text: string;
    thread_hash: string;
    hash: string;
    author?: {
      verified_addresses?: {
        eth_addresses?: string[];
      };
    };
    embeds?: Array<{
      url?: string;
    }>;
  };
}

interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface BackgroundToolRequest {
  toolCallId: string;
  runId: string;
  threadId: string;
  toolName: string;
  args: Record<string, unknown>;
  parent: string;
  verifiedAddress?: string;
}

// Constants
const ASSISTANT_ID = 'asst_YhRgpzqRTyNuGHsq7yRWOEtQ';
const POLLING_INTERVAL = 1000;

// Helper functions
const validateRequest = (data: CommodusRequest['data']) => {
  if (!data.text || !data.thread_hash) {
    throw new Error('Missing required fields: text and thread_hash');
  }
};

const getContentWithImage = (text: string, image?: string) => {
  return image ? `${text}\n\n${image}` : text;
};

const waitForRunCompletion = async (
  client: OpenAI,
  threadId: string,
  runId: string
) => {
  let runStatus;
  do {
    await new Promise((r) => setTimeout(r, POLLING_INTERVAL));
    runStatus = await client.beta.threads.runs.retrieve(threadId, runId);
  } while (runStatus.status === 'in_progress');
  return runStatus;
};

const handleCompletedRun = async (
  client: OpenAI,
  threadId: string,
  parent: string
) => {
  const messages = await client.beta.threads.messages.list(threadId);
  const msg = messages.data.find((m) => m.role === 'assistant');
  const content = msg?.content?.[0];

  if (content && 'text' in content) {
    console.log('✅ Assistant response:', content.text.value);
    await publishCast(content.text.value, parent);
  }
};

const handleToolCalls = (
  toolCalls: ToolCall[],
  runId: string,
  threadId: string,
  parent: string,
  verifiedAddress?: string
) => {
  for (const call of toolCalls) {
    const args = JSON.parse(call.function.arguments);
    const backgroundRequest: BackgroundToolRequest = {
      toolCallId: call.id,
      runId,
      threadId,
      toolName: call.function.name,
      args,
      parent,
      verifiedAddress,
    };

    fetch(`${process.env.BASE_URL}/api/handle-tool.background`, {
      method: 'POST',
      body: JSON.stringify(backgroundRequest),
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const client = new OpenAI();

  try {
    const req: CommodusRequest = await request.json();
    const { data } = req;
    const { text, thread_hash, hash: parent, author, embeds } = data;
    const verifiedAddress = author?.verified_addresses?.eth_addresses?.[0];
    const image = embeds?.[0]?.url;

    console.log('thread_hash', thread_hash);

    validateRequest(data);

    // Create thread and add message
    const threadId = 'thread_29SRyMG4UpW7XdmLaoOhc0yu';
    console.log('threadId', threadId);

    const content = getContentWithImage(text, image);
    await client.beta.threads.messages.create(threadId, {
      role: 'user',
      content,
    });

    // Run assistant
    const run = await client.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
    });
    console.log('run', run);

    const runStatus = await waitForRunCompletion(client, threadId, run.id);
    console.log('runStatus', runStatus);

    if (runStatus.status === 'completed') {
      await handleCompletedRun(client, threadId, parent);
    } else if (runStatus.status === 'requires_action') {
      const toolCalls =
        runStatus.required_action?.submit_tool_outputs?.tool_calls;
      if (!toolCalls) {
        return NextResponse.json({ status: 'NO_TOOL_CALLS' });
      }
      handleToolCalls(toolCalls, run.id, threadId, parent, verifiedAddress);
    }

    return NextResponse.json({ status: 'TRADE_PENDING' });
  } catch (error) {
    console.error('Error in Commodus API route:', error);
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
