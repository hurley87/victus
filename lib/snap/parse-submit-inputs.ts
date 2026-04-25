/**
 * Snap submit bodies:
 * - Bare JSON `{ "inputs": { … } }` (tests / tooling)
 * - JFS compact: `header.payload.signature` (base64url segments; payload JSON holds `inputs`)
 * - JFS JSON envelope: `{ "header", "payload", "signature" }` with the same base64url payload
 *
 * @see https://docs.farcaster.xyz/snap/auth#jfs-payload-shape
 */
function inputsFromPayload(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null) return null;
  const inputs = (data as { inputs?: unknown }).inputs;
  if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
    return inputs as Record<string, unknown>;
  }
  return null;
}

function inputsFromBase64UrlPayload(segment: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    return inputsFromPayload(JSON.parse(json));
  } catch {
    return null;
  }
}

export function parseSnapSubmitInputsFromBody(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return {};

  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const direct = inputsFromPayload(obj);
      if (direct != null) return direct;

      if (typeof obj.payload === "string") {
        const fromEnvelope = inputsFromBase64UrlPayload(obj.payload);
        if (fromEnvelope != null) return fromEnvelope;
      }
    } catch {
      return {};
    }
    return {};
  }

  const parts = text.split(".");
  if (parts.length === 3 && parts[1]) {
    const fromCompact = inputsFromBase64UrlPayload(parts[1]);
    if (fromCompact != null) return fromCompact;
  }

  return {};
}
