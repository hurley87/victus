import { publishCast } from '@/lib/neynar';
import { supabaseService } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { Thread } from 'openai/resources/beta/threads/threads';
import { Run } from 'openai/resources/beta/threads/runs/runs';

// Types
interface CommodusRequestData {
  text: string;
  thread_hash: string;
  hash: string;
  author?: {
    fid?: number;
    verified_addresses?: {
      eth_addresses?: string[];
    };
  };
  embeds?: Array<{
    url?: string;
  }>;
}
interface CommodusRequest {
  data: CommodusRequestData;
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
const POLLING_INTERVAL = 1000; // ms

// --- Helper Functions ---

/**
 * Constructs the content string, optionally appending an image URL.
 * @param text - The main text content.
 * @param image - Optional image URL.
 * @returns The combined content string.
 */
const getContentWithImage = (text: string, image?: string): string => {
  return image ? `${text}\n\n${image}` : text;
};

/**
 * Waits for an OpenAI run to complete by polling its status.
 * @param client - The OpenAI client instance.
 * @param threadId - The ID of the thread the run belongs to.
 * @param runId - The ID of the run to monitor.
 * @returns The completed or final status Run object.
 */
const waitForRunCompletion = async (
  client: OpenAI,
  threadId: string,
  runId: string
): Promise<Run> => {
  let runStatus: Run;
  do {
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
    try {
      runStatus = await client.beta.threads.runs.retrieve(threadId, runId);
    } catch (error) {
      console.error(`Error retrieving run status for run ${runId}:`, error);
      // Decide how to handle polling errors, e.g., retry limit or throw
      throw new Error(`Failed to retrieve run status: ${error}`);
    }
  } while (runStatus.status === 'in_progress' || runStatus.status === 'queued');
  return runStatus;
};

/**
 * Handles a completed OpenAI run by extracting the assistant's response and publishing it.
 * @param client - The OpenAI client instance.
 * @param threadId - The ID of the thread.
 * @param parent - The parent cast hash to reply to.
 */
const handleCompletedRun = async (
  client: OpenAI,
  threadId: string,
  parent: string
): Promise<void> => {
  try {
    const messages = await client.beta.threads.messages.list(threadId, {
      order: 'desc',
      limit: 1, // Only need the latest message
    });
    const latestMessage = messages.data[0];

    if (
      latestMessage?.role === 'assistant' &&
      latestMessage.content[0]?.type === 'text'
    ) {
      const assistantResponse = latestMessage.content[0].text.value;
      console.log('✅ Assistant response:', assistantResponse);
      await publishCast(assistantResponse, parent);
      console.log(`Published cast reply to ${parent}`);
    } else {
      console.warn(
        `No suitable assistant message found in thread ${threadId} to publish.`
      );
    }
  } catch (error) {
    console.error(
      `Error handling completed run for thread ${threadId}:`,
      error
    );
    // Consider re-throwing or specific error handling
  }
};

/**
 * Initiates background processing for required tool calls from an OpenAI run.
 * @param toolCalls - An array of tool calls required by the assistant.
 * @param runId - The ID of the run requiring action.
 * @param threadId - The ID of the thread.
 * @param parent - The parent cast hash.
 * @param verifiedAddress - The verified Ethereum address of the user, if available.
 */
const handleToolCalls = (
  toolCalls: ToolCall[],
  runId: string,
  threadId: string,
  parent: string,
  verifiedAddress?: string
): void => {
  console.log(`Handling ${toolCalls.length} tool call(s) for run ${runId}`);
  for (const call of toolCalls) {
    try {
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

      // Use void operator to explicitly ignore the promise
      void fetch(`${process.env.BASE_URL}/api/handle-tool.background`, {
        method: 'POST',
        body: JSON.stringify(backgroundRequest),
        headers: { 'Content-Type': 'application/json' },
      }).catch((fetchError) => {
        // Catch potential errors from the fetch itself (e.g., network issues)
        console.error(
          `Error initiating background task for tool ${call.function.name} (call ID: ${call.id}):`,
          fetchError
        );
      });
      console.log(`Dispatched background task for tool: ${call.function.name}`);
    } catch (parseError) {
      console.error(
        `Error parsing arguments for tool ${call.function.name} (call ID: ${call.id}):`,
        parseError
      );
      // Decide how to handle parsing errors, maybe skip this tool call?
    }
  }
};

/**
 * Retrieves or creates an OpenAI thread ID for a given user FID.
 * Manages user record creation/update and message count increment in Supabase.
 * @param client - The OpenAI client instance.
 * @param fid - The user's Farcaster ID.
 * @returns The OpenAI thread ID for the user.
 * @throws Throws an error if the user cannot be processed or thread creation fails.
 */
const getUserOpenAIThreadId = async (
  client: OpenAI,
  fid: number
): Promise<string> => {
  let user;
  try {
    user = await supabaseService.getUserByFid(fid);
  } catch (error) {
    console.error(`Error fetching user by FID ${fid}:`, error);
    throw new Error(`Failed to fetch user data for FID ${fid}.`);
  }

  let openai_thread_id = user?.[0]?.openai_thread_id;

  if (!openai_thread_id) {
    console.log(`No OpenAI thread found for user ${fid}. Creating new thread.`);
    try {
      const thread: Thread = await client.beta.threads.create();
      openai_thread_id = thread.id;
      console.log(
        `Created new OpenAI thread ${openai_thread_id} for user ${fid}.`
      );
    } catch (error) {
      console.error(`Error creating OpenAI thread for user ${fid}:`, error);
      throw new Error(`Failed to create OpenAI thread for user ${fid}.`);
    }
  }

  // Upsert user and increment count regardless of whether thread was new
  try {
    await supabaseService.upsertUser({
      fid,
      openai_thread_id,
      last_updated: new Date().toISOString(),
    });
    console.log(`Upserted user ${fid} with thread ID ${openai_thread_id}`);
    await supabaseService.incrementUserMessageCount(fid);
    console.log(`Incremented message count for user ${fid}`);
  } catch (error) {
    // Log error but allow processing to continue if possible,
    // as the core function might still succeed.
    console.error(
      `Error during user upsert or message count increment for FID ${fid}:`,
      error
    );
    // Depending on requirements, you might want to throw here to halt processing
    // throw new Error(`Failed to update user record for FID ${fid}.`);
  }

  return openai_thread_id;
};

/**
 * Retrieves or creates an OpenAI thread ID based on a conversation's thread hash.
 * Manages conversation record creation/update in Supabase.
 * @param client - The OpenAI client instance.
 * @param thread_hash - The unique hash identifying the conversation thread.
 * @returns The OpenAI thread ID for the conversation.
 * @throws Throws an error if the conversation cannot be processed or thread creation fails.
 */
const getConversationOpenAIThreadId = async (
  client: OpenAI,
  thread_hash: string
): Promise<string> => {
  let conversations;
  try {
    conversations = await supabaseService.getConversationByThreadHash(
      thread_hash
    );
  } catch (error) {
    console.error(
      `Error fetching conversation by thread_hash ${thread_hash}:`,
      error
    );
    throw new Error(
      `Failed to fetch conversation data for thread_hash ${thread_hash}.`
    );
  }

  if (conversations && conversations.length > 0) {
    const openai_thread_id = conversations[0].openai_thread_id;
    console.log(
      `Using existing OpenAI thread ${openai_thread_id} for thread_hash ${thread_hash}`
    );
    return openai_thread_id;
  } else {
    console.log(
      `No conversation found for thread_hash ${thread_hash}. Creating new thread.`
    );
    try {
      const thread: Thread = await client.beta.threads.create();
      const openai_thread_id = thread.id;
      console.log(
        `Created new OpenAI thread ${openai_thread_id} for thread_hash ${thread_hash}`
      );
      // Save the new conversation record immediately
      await supabaseService.upsertConversation({
        thread_hash,
        openai_thread_id,
      });
      console.log(
        `Saved new conversation record for thread_hash ${thread_hash}`
      );
      return openai_thread_id;
    } catch (error) {
      console.error(
        `Error creating OpenAI thread or saving conversation for thread_hash ${thread_hash}:`,
        error
      );
      throw new Error(
        `Failed to create OpenAI thread/conversation for thread_hash ${thread_hash}.`
      );
    }
  }
};

/**
 * Processes the interaction with the OpenAI assistant for a given thread.
 * Adds user message, runs assistant, waits, and handles completion or tool calls.
 * @param client - The OpenAI client instance.
 * @param threadId - The OpenAI thread ID for the conversation.
 * @param content - The user message content to add.
 * @param parent - The parent cast hash for potential replies.
 * @param verifiedAddress - The user's verified address for tool calls.
 */
const processOpenAIInteraction = async (
  client: OpenAI,
  threadId: string,
  content: string,
  parent: string,
  verifiedAddress?: string
): Promise<void> => {
  try {
    // --- Add Message to Conversation Thread ---
    await client.beta.threads.messages.create(threadId, {
      role: 'user',
      content,
    });
    console.log(`Added user message to thread ${threadId}`);

    // --- Run Assistant on Conversation Thread ---
    const run = await client.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
    });
    console.log(`Started run ${run.id} for thread ${threadId}`);

    const runStatus = await waitForRunCompletion(client, threadId, run.id);
    console.log(`Run ${run.id} completed with status: ${runStatus.status}`);

    // --- Handle Run Outcome ---
    if (runStatus.status === 'completed') {
      await handleCompletedRun(client, threadId, parent);
    } else if (runStatus.status === 'requires_action') {
      const toolCalls =
        runStatus.required_action?.submit_tool_outputs?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        handleToolCalls(toolCalls, run.id, threadId, parent, verifiedAddress);
      } else {
        console.warn(`Run ${run.id} requires action but has no tool calls.`);
        // Potentially handle this case, maybe log an error or return specific status
      }
    } else {
      // Handle other statuses like 'failed', 'cancelled', 'expired'
      console.error(
        `Run ${run.id} ended with unhandled status: ${runStatus.status}`,
        runStatus.last_error // Log error details if available
      );
      // Potentially throw an error or return a specific status
      throw new Error(`Run failed with status ${runStatus.status}.`);
    }
  } catch (error) {
    console.error(
      `Error during OpenAI interaction for thread ${threadId}:`,
      error
    );
    // Re-throw the error to be caught by the main handler
    throw error;
  }
};

// --- API Route Handler ---

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const client = new OpenAI();

  try {
    // --- Request Parsing and Validation ---
    const req: CommodusRequest = await request.json();
    const { data } = req;
    const { text, thread_hash, hash: parent, author, embeds } = data;

    const fid = author?.fid;
    if (!fid) {
      console.warn('Request received without FID.');
      // Consider returning a more specific error response if FID is mandatory
      return NextResponse.json(
        { success: false, message: 'User FID is missing.' },
        { status: 400 } // Bad Request
      );
    }

    const verifiedAddress = author?.verified_addresses?.eth_addresses?.[0];
    const image = embeds?.[0]?.url;
    const content = getContentWithImage(text, image); // Prepare content early

    // --- User and Conversation Thread Management ---
    // Note: getUserOpenAIThreadId is called but its return value (user's personal thread) isn't directly used later.
    // It's primarily for ensuring the user exists, updating their record, and incrementing count.
    // If the user-specific thread *was* needed, it should be stored.
    await getUserOpenAIThreadId(client, fid);

    const conversationThreadId = await getConversationOpenAIThreadId(
      client,
      thread_hash
    );

    // --- Process OpenAI Interaction ---
    await processOpenAIInteraction(
      client,
      conversationThreadId,
      content,
      parent, // Pass the original cast hash as parent
      verifiedAddress
    );

    // --- Respond ---
    // The response indicates the process was initiated. Actual result comes via background task/callback.
    return NextResponse.json({ status: 'PROCESSING_INITIATED' }); // More descriptive status
  } catch (error) {
    console.error('Error in Commodus API route:', error);
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred.';
    // Determine appropriate status code based on error type if possible
    const status =
      error instanceof Error &&
      (error.message.includes('fetch user data') ||
        error.message.includes('conversation data'))
        ? 503
        : 500; // Service Unavailable for DB errors

    return NextResponse.json(
      {
        success: false,
        message: `Failed to process request: ${message}`,
        error: String(error), // Avoid sending full Error object in response
      },
      { status }
    );
  }
}
