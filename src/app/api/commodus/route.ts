import { publishCast } from '@/lib/neynar';
import { supabaseService, User } from '@/lib/supabase';
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
    profile?: {
      bio?: {
        text?: string;
      };
    };
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
const MEMORY_UPDATE_INTERVAL = 10; // Number of messages before updating memory
const NEYNAR_CAST_CHAR_LIMIT = 320; // Max characters for a Farcaster cast

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

      // --- Validation before publishing ---
      if (!assistantResponse || assistantResponse.trim().length === 0) {
        console.warn(
          `⚠️ Assistant generated empty response for thread ${threadId}. Skipping publish.`
        );
        return; // Don't publish empty casts
      }

      if (assistantResponse.length > NEYNAR_CAST_CHAR_LIMIT) {
        console.warn(
          `⚠️ Assistant response exceeded character limit (${assistantResponse.length}/${NEYNAR_CAST_CHAR_LIMIT}) for thread ${threadId}. Skipping publish.`
        );
        // Optionally, you could truncate the message here:
        const truncatedResponse = assistantResponse.slice(
          0,
          NEYNAR_CAST_CHAR_LIMIT
        );
        await publishCast(truncatedResponse, parent);
        return; // Don't publish oversized casts (or publish truncated)
      }
      // --- End Validation ---

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
 * Checks and triggers memory summarization if needed.
 * @param client - The OpenAI client instance.
 * @param fid - The user's Farcaster ID.
 * @returns The OpenAI thread ID for the user.
 * @throws Throws an error if the user cannot be processed or thread creation fails.
 */
const getUserOpenAIThreadId = async (
  client: OpenAI,
  fid: number,
  bio?: string
) => {
  let userResult;
  try {
    // Fetch the full user record
    userResult = await supabaseService.getUserByFid(fid);
  } catch (error) {
    console.error(`Error fetching user by FID ${fid}:`, error);
    throw new Error(`Failed to fetch user data for FID ${fid}.`);
  }

  let user: User | null = (userResult?.[0] as User) || null;
  let openai_thread_id = user?.openai_thread_id;

  // Create thread and initial user record if user or thread doesn't exist
  if (!user || !openai_thread_id) {
    console.log(
      `User ${fid} or OpenAI thread not found. Creating new thread and user record.`
    );
    try {
      const thread: Thread = await client.beta.threads.create();
      openai_thread_id = thread.id;
      console.log(
        `Created new OpenAI thread ${openai_thread_id} for user ${fid}.`
      );
      // Insert the new user with initial values
      const newUserRecord = {
        fid,
        openai_thread_id,
        last_updated: new Date().toISOString(),
        memory: bio,
        message_count: 0,
      };
      await supabaseService.upsertUser(newUserRecord);
      console.log(`Inserted new user record for FID ${fid}`);
      // Fetch the newly created user record to have a consistent 'user' object
      userResult = await supabaseService.getUserByFid(fid);
      user = (userResult?.[0] as User) || null;
      if (!user) throw new Error('Failed to retrieve newly created user.');
    } catch (error) {
      console.error(
        `Error creating OpenAI thread or initial user record for FID ${fid}:`,
        error
      );
      throw new Error(
        `Failed to create OpenAI thread or initial user record for FID ${fid}.`
      );
    }
  }

  // --- Increment Message Count and Check for Memory Update ---
  let updatedUser: User | null = null;
  try {
    // Increment count first
    await supabaseService.incrementUserMessageCount(fid);
    console.log(`Incremented message count for user ${fid}`);

    // Fetch the user again AFTER incrementing to get the latest message count
    const updatedUserResult = await supabaseService.getUserByFid(fid);
    updatedUser = (updatedUserResult?.[0] as User) || null;

    if (!updatedUser) {
      throw new Error(`Failed to fetch user ${fid} after incrementing count.`);
    }

    // Check if memory update is needed using modulo operator
    const currentMessageCount = updatedUser.message_count;
    console.log(`User ${fid}: Current msg count: ${currentMessageCount}`);

    // Trigger update if message count is a multiple of the interval (and not 0)
    if (
      currentMessageCount > 0 &&
      currentMessageCount % MEMORY_UPDATE_INTERVAL === 0
    ) {
      console.log(
        `Triggering memory update based on count ${currentMessageCount}`
      );
      // Trigger update asynchronously by calling the background endpoint
      // Add null check for updatedUser and capture fid to satisfy linter
      if (updatedUser) {
        const userFid = updatedUser.fid; // Capture FID here
        void fetch(`${process.env.BASE_URL}/api/update-memory.background`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fid: userFid }), // Use captured FID
        }).catch((fetchError) => {
          // Catch potential errors from the fetch itself (e.g., network issues)
          console.error(
            `Error initiating background memory update task for FID ${userFid}:`, // Use captured FID
            fetchError
          );
        });
      }
    }

    // Update 'last_updated' timestamp
    await supabaseService.upsertUser({
      fid,
      openai_thread_id: updatedUser.openai_thread_id, // ensure this is passed
      last_updated: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      `Error during user message count increment or memory update check for FID ${fid}`,
      error
    );
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
export const maxDuration = 300;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const client = new OpenAI();

  try {
    // --- Request Parsing and Validation ---
    const req: CommodusRequest = await request.json();
    const { data } = req;
    const { text, thread_hash, hash: parent, author, embeds } = data;
    const bio = author?.profile?.bio?.text;
    const fid = author?.fid;

    if (!fid) {
      console.warn('Request received without FID.');
      // Consider returning a more specific error response if FID is mandatory
      return NextResponse.json({
        success: false,
        message: 'User FID is missing.',
      });
    }

    const verifiedAddress = author?.verified_addresses?.eth_addresses?.[0];
    const image = embeds?.[0]?.url;
    const content = getContentWithImage(text, image); // Prepare content early

    // --- User and Conversation Thread Management ---
    // Get the user's primary OpenAI thread ID. This handles user creation,
    // message increment, and triggers memory update check using the user's thread.
    // Note: This seems related to the user's overall context, not the specific conversation thread_hash
    getUserOpenAIThreadId(client, fid, bio);

    // --- Conversation Thread Handling ---
    let conversationThreadId: string | null = null; // Use a specific variable for the conversation thread

    try {
      const conversationResult =
        await supabaseService.getConversationByThreadHash(thread_hash);

      console.log('Raw conversationResult:', conversationResult); // Log the raw result for debugging

      // Check if result is an array and has at least one element with the expected property
      if (
        Array.isArray(conversationResult) &&
        conversationResult.length > 0 &&
        typeof conversationResult[0]?.openai_thread_id === 'string' // Explicitly check type
      ) {
        conversationThreadId = conversationResult[0].openai_thread_id;
        console.log(
          `Found existing conversation thread: ${conversationThreadId} for hash ${thread_hash}`
        );
      } else {
        console.warn(
          `Thread ${thread_hash} not found or result format unexpected. Creating new thread.`
        );
        const newThread = await client.beta.threads.create();
        conversationThreadId = newThread.id;
        await supabaseService.upsertConversation({
          thread_hash,
          openai_thread_id: conversationThreadId,
        });
        console.log(
          `Created and saved new conversation thread: ${conversationThreadId} for hash ${thread_hash}`
        );
      }
    } catch (dbError) {
      console.error(
        `Error fetching or creating conversation thread for hash ${thread_hash}:`,
        dbError
      );
      throw new Error(
        `Failed to manage conversation thread for hash ${thread_hash}.`
      );
    }

    // Ensure we have a valid thread ID before proceeding
    if (!conversationThreadId) {
      console.error(
        `Failed to obtain a valid conversation thread ID for hash ${thread_hash}.`
      );
      return NextResponse.json(
        {
          success: false,
          message: `Failed to obtain a valid conversation thread ID for hash ${thread_hash}.`,
        },
        { status: 500 } // Internal Server Error
      );
    }

    console.log('conversationThreadId', conversationThreadId);

    // --- Process OpenAI Interaction using the conversation thread ---
    await processOpenAIInteraction(
      client,
      conversationThreadId, // Use the specific conversation thread ID
      content,
      parent,
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
        error.message.includes('conversation data') ||
        error.message.includes('Failed to create OpenAI thread')) // Add thread creation error
        ? 503 // Service Unavailable for critical DB/dependency errors
        : 500; // Internal Server Error for others

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
