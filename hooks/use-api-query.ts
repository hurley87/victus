import { useQuery, UseQueryOptions } from "@tanstack/react-query";

import { ApiError } from "@/lib/api-error";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface UseApiQueryOptions<TData, TBody = unknown>
  extends Omit<UseQueryOptions<TData>, "queryFn"> {
  url: string;
  method?: HttpMethod;
  body?: TBody;
  isProtected?: boolean;
  enabled?: boolean;
}

export const useApiQuery = <TData, TBody = unknown>(
  options: UseApiQueryOptions<TData, TBody>
) => {
  const {
    url,
    method = "GET",
    body,
    isProtected = false,
    enabled = true,
    ...queryOptions
  } = options;

  return useQuery<TData>({
    ...queryOptions,
    enabled,
    queryFn: async () => {
      const response = await fetch(url, {
        method,
        headers: {
          ...(body && { "Content-Type": "application/json" }),
        },
        ...(isProtected && {
          credentials: "include",
        }),
        ...(body && { body: JSON.stringify(body) }),
      });

      if (!response.ok) {
        throw await ApiError.fromResponse(response);
      }

      return response.json();
    },
  });
};
