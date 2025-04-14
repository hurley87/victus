import { ConversationMessage, OpenAIMessage, MessageRole } from './types';

/**
 * Transforms conversation messages to OpenAI message format
 * @param messages - Array of conversation messages
 * @param newText - New text to append as a user message
 * @returns Array of OpenAI formatted messages
 */
export function transformMessages(
  messages: ConversationMessage[],
  newText: string
): OpenAIMessage[] {
  const transformedMessages = messages.map((msg) => ({
    role: (msg.author === 'commodus' ? 'assistant' : 'user') as MessageRole,
    content: msg.text,
  }));

  // Append the new message
  transformedMessages.push({
    role: 'user',
    content: newText,
  });

  return transformedMessages;
}
