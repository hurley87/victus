/**
 * Snap submit bodies are either bare JSON `{ "inputs": { … } }` (tests) or a JFS
 * compact string whose middle segment is base64url JSON with the same `inputs`.
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

export function parseSnapSubmitInputsFromBody(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return {};

  if (text.startsWith("{")) {
    try {
      return inputsFromPayload(JSON.parse(text)) ?? {};
    } catch {
      return {};
    }
  }

  const parts = text.split(".");
  if (parts.length !== 3 || !parts[1]) return {};

  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return inputsFromPayload(JSON.parse(json)) ?? {};
  } catch {
    return {};
  }
}
