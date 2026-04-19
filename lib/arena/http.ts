import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";

/**
 * Shared route helpers for the Arena API surface.
 */

type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/**
 * Read an optional JSON body and validate with `schema`.
 *
 * - Empty body (no / zero `Content-Length`) → `schema.parse(undefined)` so
 *   callers can model "no body" with `z.object({...}).optional()` or a
 *   schema whose top level is `optional()`.
 * - Invalid JSON → 400 `{ error: "Invalid JSON body" }`.
 * - Zod failure → 400 with the first issue message (or a generic fallback).
 */
export async function parseOptionalJsonBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<ParsedBody<T>> {
  const contentLength = request.headers.get("content-length");
  const hasBody = Boolean(contentLength && contentLength !== "0");

  let raw: unknown = undefined;
  if (hasBody) {
    try {
      raw = await request.json();
    } catch {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 },
        ),
      };
    }
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        { status: 400 },
      ),
    };
  }

  return { ok: true, data: parsed.data };
}
