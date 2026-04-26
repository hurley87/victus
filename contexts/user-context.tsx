"use client";

import { ApiError } from "@/lib/api-error";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { MiniAppContext } from "@farcaster/miniapp-core/dist/context";
import sdk from "@farcaster/miniapp-sdk";
import {
  QueryObserverResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useFarcaster } from "./farcaster-context";

const USER_QUERY_KEY = ["user-query"] as const;

type UserContextValue = {
  user: {
    data: AuthenticatedUser | undefined;
    refetch: () => Promise<QueryObserverResult<AuthenticatedUser>>;
    isLoading: boolean;
    error: Error | null;
  };
  isSignedIn: boolean;
  signIn: () => Promise<void>;
  isLoading: boolean;
  error: Error | null;
};

const UserProviderContext = createContext<UserContextValue | undefined>(
  undefined,
);

interface UserProviderProps {
  children: ReactNode;
  autoSignIn?: boolean;
}

export const useUser = () => {
  const context = useContext(UserProviderContext);
  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
};

export const UserProvider = ({
  children,
  autoSignIn = false,
}: UserProviderProps) => {
  const { context } = useFarcaster();
  const queryClient = useQueryClient();

  // One query owns the entire "who am I?" lifecycle. On 401 it transparently
  // runs SIWF Quick Auth + /api/auth/sign-in (when `autoSignIn` is on and a
  // Farcaster context is available) and returns the resulting user. This lets
  // `isSignedIn` be derived purely from `data` and avoids a `useEffect` that
  // reacts to the query's error state.
  const userQuery = useQuery<AuthenticatedUser, Error>({
    queryKey: USER_QUERY_KEY,
    enabled: !autoSignIn || Boolean(context),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const me = await fetchMe();
      if (me.ok) return me.user;

      if (!autoSignIn || !context) {
        throw new ApiError(me.status, `API Error: ${me.status}`);
      }

      return await performSignIn(context);
    },
  });

  const signInMutation = useMutation<AuthenticatedUser, Error, void>({
    mutationFn: async () => {
      if (!context) {
        throw new Error("Not in mini app");
      }
      return await performSignIn(context);
    },
    onSuccess: (user) => {
      queryClient.setQueryData(USER_QUERY_KEY, user);
    },
  });

  const signIn = useCallback(async () => {
    try {
      await signInMutation.mutateAsync();
    } catch {
      // Error is surfaced via `signInMutation.error` → `value.error`.
    }
  }, [signInMutation]);

  const value = useMemo<UserContextValue>(() => {
    return {
      user: {
        data: userQuery.data,
        refetch: userQuery.refetch,
        isLoading: userQuery.isLoading,
        error: userQuery.error,
      },
      signIn,
      isSignedIn: Boolean(userQuery.data),
      isLoading: userQuery.isLoading || signInMutation.isPending,
      error: signInMutation.error ?? userQuery.error ?? null,
    };
  }, [
    userQuery.data,
    userQuery.refetch,
    userQuery.isLoading,
    userQuery.error,
    signInMutation.isPending,
    signInMutation.error,
    signIn,
  ]);

  return (
    <UserProviderContext.Provider value={value}>
      {children}
    </UserProviderContext.Provider>
  );
};

type FetchMeResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; status: number };

async function fetchMe(): Promise<FetchMeResult> {
  const res = await fetch("/api/users/me", { credentials: "include" });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, user: (await res.json()) as AuthenticatedUser };
}

async function performSignIn(
  context: MiniAppContext,
): Promise<AuthenticatedUser> {
  const referrerFidFromUrl = parseReferrerFidFromUrl();
  const referrerFidFromCast =
    context.location?.type === "cast_embed"
      ? context.location.cast.author.fid
      : undefined;
  const referrerFid = referrerFidFromUrl ?? referrerFidFromCast;

  const token = await sdk.quickAuth.getToken();
  if (!token) {
    throw new Error("No token from SIWF Quick Auth");
  }

  const res = await fetch("/api/auth/sign-in", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fid: context.user.fid,
      referrerFid,
      token: token.token,
    }),
  });

  if (!res.ok) {
    throw await ApiError.fromResponse(res);
  }

  const body = (await res.json()) as { success: boolean; user: AuthenticatedUser };
  if (!body.success || !body.user) {
    throw new Error("Sign-in response missing user");
  }
  return body.user;
}

function parseReferrerFidFromUrl(): number | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const raw = new URLSearchParams(window.location.search).get("ref");
  if (!raw) {
    return undefined;
  }
  const fid = Number(raw);
  if (!Number.isFinite(fid) || !Number.isInteger(fid) || fid <= 0) {
    return undefined;
  }
  return fid;
}
