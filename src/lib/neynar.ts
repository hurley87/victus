import { NeynarAPIClient } from '@neynar/nodejs-sdk';

// Initialize client
const neynarClient = new NeynarAPIClient({
  apiKey: process.env.NEYNAR_API_KEY as string,
});

/**
 * Publishes a cast to Farcaster via Neynar API
 *
 * @param text The text content of the cast
 * @param parent The parent cast hash to reply to
 * @param url Optional URL to embed in the cast
 * @returns The response from the Neynar API
 */
export const publishCast = async (
  text: string,
  parent: string,
  url?: string
) => {
  const signerUuid = process.env.SIGNER_UUID as string;
  const response = await neynarClient.publishCast({
    signerUuid,
    text,
    parent,
    embeds: url ? [{ url }] : undefined,
  });
  return response;
};
