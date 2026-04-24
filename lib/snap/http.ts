import type { NextRequest } from "next/server";

export const SNAP_MEDIA = "application/vnd.farcaster.snap+json";

export function requestAcceptsSnap(acceptHeader: string | null): boolean {
  if (!acceptHeader) return false;
  return acceptHeader.split(",").some((part) => {
    const token = part.trim().split(";")[0];
    return token !== undefined && token.trim() === SNAP_MEDIA;
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/**
 * `Vary` value for snap routes — add `Origin` only when the client sent one
 * so intermediate caches can serve the same response to non-CORS clients.
 */
export function snapVaryHeader(request: NextRequest): string {
  return request.headers.get("origin") ? "Accept, Origin" : "Accept";
}
