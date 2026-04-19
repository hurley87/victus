/**
 * Thrown by the shared `useApiMutation` / `useApiQuery` hooks (and
 * any ad-hoc `fetch` paths like `performSignIn`) when a response
 * comes back non-2xx. Carries the HTTP status and the parsed JSON
 * body so UI-layer mappers can switch on `err.status` instead of
 * regex-parsing `err.message`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /**
   * Best-effort JSON parse; falls back to status-only. Safe to call
   * on any non-2xx response — never throws.
   */
  static async fromResponse(response: Response): Promise<ApiError> {
    const body = await response
      .clone()
      .json()
      .catch(() => undefined);
    const message =
      (body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : null) ?? `API Error: ${response.status}`;
    return new ApiError(response.status, message, body);
  }
}
