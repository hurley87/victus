import { useMutation, useQueryClient, UseMutationOptions } from "@tanstack/react-query";

import { ApiError } from "@/lib/api-error";
import { fetchWithOptional401SessionRefresh } from "@/lib/auth/fetch-with-session-refresh";
import { isSessionRefreshEligibleApiUrl } from "@/lib/auth/user-query-key";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface UseApiMutationOptions<TData, TVariables>
  extends Omit<UseMutationOptions<TData, Error, TVariables>, "mutationFn"> {
  url: string | ((variables: TVariables) => string);
  method?: HttpMethod;
  isProtected?: boolean;
  body?: (variables: TVariables) => unknown;
}

export const useApiMutation = <TData, TVariables = unknown>(
  options: UseApiMutationOptions<TData, TVariables>
) => {
  const queryClient = useQueryClient();
  const {
    url,
    method = "POST",
    isProtected = true,
    ...mutationOptions
  } = options;

  return useMutation<TData, Error, TVariables>({
    ...mutationOptions,
    mutationFn: async (variables) => {
      const resolvedUrl = typeof url === "function" ? url(variables) : url;
      const resolvedBody = options.body ? options.body(variables) : null;

      const runFetch = () =>
        fetch(resolvedUrl, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          ...(isProtected && {
            credentials: "include",
          }),
          ...(resolvedBody ? { body: JSON.stringify(resolvedBody) } : {}),
        });

      const response = await fetchWithOptional401SessionRefresh(
        queryClient,
        isProtected && isSessionRefreshEligibleApiUrl(resolvedUrl),
        runFetch,
      );

      if (!response.ok) {
        throw await ApiError.fromResponse(response);
      }

      return response.json();
    },
  });
};
