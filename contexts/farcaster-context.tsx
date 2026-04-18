"use client";

import type {
  MiniAppContext,
  SafeAreaInsets,
} from "@farcaster/miniapp-core/dist/context";
import {
  type MiniAppHostCapability,
  sdk as miniappSdk,
} from "@farcaster/miniapp-sdk";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";

type FarcasterContextType = {
  isMiniAppReady: boolean;
  isInMiniApp: boolean;
  context: MiniAppContext | null;
  capabilities: MiniAppHostCapability[] | null;
  safeAreaInsets: SafeAreaInsets;
  error: string | null;
};

const DEFAULT_INSETS: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };

export const FarcasterContext = createContext<FarcasterContextType | undefined>(
  undefined,
);

export function useFarcaster() {
  const context = useContext(FarcasterContext);
  if (context === undefined) {
    throw new Error("useFarcaster must be used within a FarcasterProvider");
  }
  return context;
}

type BootstrapResult = {
  isInMiniApp: boolean;
  context: MiniAppContext | null;
  capabilities: MiniAppHostCapability[] | null;
  safeAreaInsets: SafeAreaInsets;
};

export function FarcasterProvider({
  addMiniAppOnLoad = false,
  children,
}: {
  addMiniAppOnLoad?: boolean;
  children: ReactNode;
}) {
  // SDK bootstrap is a one-shot async dependency, so we model it as a
  // `useQuery` with `staleTime: Infinity`. This keeps the lifecycle co-located
  // with the data and avoids a mount `useEffect` that would otherwise need to
  // juggle ~5 pieces of `useState`.
  const { data, error } = useQuery<BootstrapResult, Error>({
    queryKey: ["farcaster-bootstrap", addMiniAppOnLoad],
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      await miniappSdk.actions.ready();
      const isInMiniApp = await miniappSdk.isInMiniApp();
      const rawContext = await miniappSdk.context;

      if (!rawContext) {
        return {
          isInMiniApp,
          context: null,
          capabilities: null,
          safeAreaInsets: DEFAULT_INSETS,
        };
      }

      const context = rawContext as MiniAppContext;
      const safeAreaInsets =
        context.client.safeAreaInsets ?? DEFAULT_INSETS;

      if (addMiniAppOnLoad && !context.client.added) {
        try {
          await miniappSdk.actions.addMiniApp();
        } catch (err) {
          console.error("[error] adding miniapp", err);
        }
      }

      let capabilities: MiniAppHostCapability[] | null = null;
      try {
        capabilities = await miniappSdk.getCapabilities();
      } catch (err) {
        console.error("Failed to get capabilities", err);
      }

      return { isInMiniApp, context, capabilities, safeAreaInsets };
    },
  });

  const value = useMemo<FarcasterContextType>(
    () => ({
      isInMiniApp: data?.isInMiniApp ?? false,
      isMiniAppReady: Boolean(data?.context),
      context: data?.context ?? null,
      capabilities: data?.capabilities ?? null,
      safeAreaInsets: data?.safeAreaInsets ?? DEFAULT_INSETS,
      error: error?.message ?? null,
    }),
    [data, error],
  );

  return (
    <FarcasterContext.Provider value={value}>
      {children}
    </FarcasterContext.Provider>
  );
}
