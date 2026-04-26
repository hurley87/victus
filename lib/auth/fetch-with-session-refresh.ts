import type { QueryClient } from "@tanstack/react-query";

import { USER_QUERY_KEY } from "./user-query-key";

/** 401 + `canRefreshSession` → `fetchQuery(USER_QUERY_KEY)` then one retry. */
export async function fetchWithOptional401SessionRefresh(
  queryClient: QueryClient,
  canRefreshSession: boolean,
  runFetch: () => Promise<Response>,
): Promise<Response> {
  const response = await runFetch();
  if (response.status !== 401 || !canRefreshSession) {
    return response;
  }
  await queryClient
    .fetchQuery({ queryKey: USER_QUERY_KEY })
    .catch(() => undefined);
  return runFetch();
}
