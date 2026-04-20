import { env } from "@/lib/env";
import { log } from "@/lib/logger";

const NEYNAR_API_BASE = "https://api.neynar.com/v2/farcaster";

export interface NeynarUser {
  fid: string;
  username: string;
  display_name: string;
  pfp_url: string;
  custody_address: string;
  verifications: string[];
}

export const fetchUser = async (fid: string): Promise<NeynarUser> => {
  const response = await fetch(
    `${NEYNAR_API_BASE}/user/bulk?fids=${fid}`,
    {
      headers: {
        "x-api-key": env.NEYNAR_API_KEY,
      },
    }
  );
  if (!response.ok) {
    const httpStatus = response.status;
    log.error("neynar_user_fetch_failed", { fid, httpStatus });
    throw new Error("Failed to fetch Farcaster user on Neynar");
  }
  const data = await response.json();
  return data.users[0];
};

export interface PublishedCast {
  hash: string;
  author_fid: number;
  text: string;
}

/**
 * Error thrown when the Neynar signer is not configured. Callers in a
 * workflow step should wrap this with `FatalError` so retries don't loop.
 */
export class MissingSignerError extends Error {
  constructor() {
    super("NEYNAR_SIGNER_UUID is not set");
    this.name = "MissingSignerError";
  }
}

/**
 * Publish a reply cast as Commodus via the Neynar-managed signer.
 *
 * - Uses an idempotency key so the same `(parent, idemKey)` publish at-most-
 *   once even if the workflow step is retried.
 * - Returns the published cast hash so callers can record it alongside
 *   `cast_commands` for audit.
 *
 * @param parentCastHash The cast hash being replied to (`0x…`).
 * @param text           Reply text. Trimmed to Farcaster's 320 grapheme cap
 *                       by Neynar server-side; we don't over-truncate here.
 * @param idemKey        Stable dedupe key. Recommended: `tracer:${castHash}`,
 *                       `reply:${castHash}:${kind}`.
 */
export async function publishReplyCast(
  parentCastHash: string,
  text: string,
  idemKey: string,
  embeds?: { url: string }[],
): Promise<PublishedCast> {
  if (!env.NEYNAR_SIGNER_UUID) {
    throw new MissingSignerError();
  }

  const response = await fetch(`${NEYNAR_API_BASE}/cast`, {
    method: "POST",
    headers: {
      "x-api-key": env.NEYNAR_API_KEY,
      "content-type": "application/json",
      "idempotency-key": idemKey,
    },
    body: JSON.stringify({
      signer_uuid: env.NEYNAR_SIGNER_UUID,
      text,
      parent: parentCastHash,
      idem: idemKey,
      ...(embeds && embeds.length > 0 ? { embeds } : {}),
    }),
  });

  if (!response.ok) {
    const httpStatus = response.status;
    const body = await response.text().catch(() => "");
    log.error("neynar_cast_publish_failed", {
      httpStatus,
      parentCastHash,
      idemKey,
    });
    throw new Error(
      `Neynar cast publish failed (${httpStatus}): ${body.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    cast?: { hash: string; author?: { fid: number }; text: string };
  };

  if (!data.cast?.hash) {
    throw new Error("Neynar cast publish returned no cast.hash");
  }

  return {
    hash: data.cast.hash,
    author_fid: data.cast.author?.fid ?? -1,
    text: data.cast.text,
  };
}
