import { supabaseService } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Types (Consider moving to a shared types file if used elsewhere)
interface UserData {
  id: string;
  fid: number;
  openai_thread_id: string;
  message_count: number;
  memory?: string | null;
}

interface UpdateMemoryRequest {
  fid: number;
}

/**
 * Fetches message history, calls OpenAI for summarization, and updates the user record.
 * This function is intended to be run as a background task.
 * @param client - The OpenAI client instance.
 * @param user - The user data object including fid and openai_thread_id.
 */
const performMemoryUpdate = async (
  client: OpenAI,
  user: UserData
): Promise<void> => {
  console.log(
    `Background Task: Starting memory update for user FID: ${user.fid}`
  );
  const threadId = user.openai_thread_id;

  try {
    // 1. Fetch message history
    const messages = await client.beta.threads.messages.list(threadId, {
      limit: 100, // Fetch last 100 messages
      order: 'asc', // Chronological order for context
    });

    console.log(messages);

    if (!messages.data || messages.data.length === 0) {
      console.warn(
        `Background Task: No messages found in thread ${user.openai_thread_id} to summarize.`
      );
      return;
    }

    // 2. Format messages for summarization prompt
    const conversationHistory = messages.data
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const content =
          m.content[0]?.type === 'text'
            ? m.content[0].text.value
            : '[Non-text content]';
        return `[${m.role.toUpperCase()}] ${content}`;
      })
      .join('\n');

    const content = `
      You are summarizing the following conversation history for a user memory profile. Focus on key topics, user preferences, mentioned entities, and overall sentiment or goals expressed. Keep it concise but informative.

      Conversation:
      ${conversationHistory}

      Summary:
    `;

    // 3. Call OpenAI Chat Completions API for summarization
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are an AI assistant that summarizes conversation history into a concise user memory profile.',
        },
        { role: 'user', content },
      ],
      max_tokens: 250,
    });

    const summaryText = response.choices[0]?.message?.content?.trim();

    if (!summaryText) {
      console.error(
        `Background Task: Failed to generate summary for user FID: ${user.fid}. Empty response from OpenAI.`
      );
      return; // Don't update if summary generation failed
    }

    console.log(
      `Background Task: Generated summary for user FID ${user.fid}:`,
      summaryText
    );

    // 4. Update user record in Supabase
    await supabaseService.updateUserMemory(user.fid, {
      memory: summaryText,
    });
    console.log(
      `Background Task: Successfully updated memory for user FID ${user.fid}`
    );

    // 5. store summary in Supabase
    try {
      await supabaseService.storeMemory(user.fid, summaryText);
    } catch (error) {
      console.error(
        `Background Task: Error storing memory for user FID ${user.fid}:`,
        error
      );
    }
  } catch (error) {
    console.error(
      `Background Task: Error during memory update for user FID ${user.fid}:`,
      error
    );
    // Decide if this error should be surfaced differently or retried
  }
};

export const dynamic = 'force-dynamic';

// POST handler for the background memory update task
export async function POST(request: NextRequest): Promise<NextResponse> {
  const client = new OpenAI(); // Instantiate client for this background task

  try {
    const body: UpdateMemoryRequest = await request.json();
    const { fid } = body;

    if (!fid) {
      return NextResponse.json(
        { success: false, message: 'Missing FID in request body.' },
        { status: 400 }
      );
    }

    console.log(
      `Background Task: Received request to update memory for FID: ${fid}`
    );

    // Fetch the necessary user data (including thread_id)
    const userResult = await supabaseService.getUserByFid(fid);
    const user = (userResult?.[0] as UserData) || null;

    if (!user || !user.openai_thread_id) {
      console.error(
        `Background Task: User or OpenAI thread ID not found for FID ${fid}. Cannot update memory.`
      );
      return NextResponse.json(
        {
          success: false,
          message: `User or OpenAI thread ID not found for FID ${fid}.`,
        },
        { status: 404 } // Not Found
      );
    }

    // Perform the actual memory update logic
    await performMemoryUpdate(client, user);

    // Respond affirmatively, as the task execution is handled
    return NextResponse.json({
      success: true,
      message: `Memory update process initiated for FID ${fid}.`,
    });
  } catch (error) {
    console.error('Error in update-memory.background handler:', error);
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred.';
    return NextResponse.json(
      { success: false, message: `Failed to process request: ${message}` },
      { status: 500 }
    );
  }
}
