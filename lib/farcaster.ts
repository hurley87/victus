import { env } from "@/lib/env";
import { buildFarcasterMiniAppConfig } from "@/lib/miniapp-metadata";

/**
 * Get the Farcaster manifest for the Mini App. Account association values are
 * generated from Farcaster Developer Tools for the app's production domain.
 */
export async function getFarcasterManifest() {
  const miniapp = buildFarcasterMiniAppConfig(env.NEXT_PUBLIC_URL);

  return {
    accountAssociation: {
      header: env.NEXT_PUBLIC_FARCASTER_HEADER,
      payload: env.NEXT_PUBLIC_FARCASTER_PAYLOAD,
      signature: env.NEXT_PUBLIC_FARCASTER_SIGNATURE,
    },
    miniapp,
    frame: miniapp,
  };
}
