"use client";

import { useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { useFarcaster } from "@/contexts/farcaster-context";

export type ShareController = {
  canCompose: boolean;
  pending: string | null;
  error: string | null;
  share: (key: string, text: string) => Promise<void>;
};

export function useShareCast(): ShareController {
  const { capabilities } = useFarcaster();
  const canCompose = capabilities?.includes("actions.composeCast") ?? true;
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function share(key: string, text: string) {
    setPending(key);
    setError(null);
    try {
      await sdk.actions.composeCast({ text });
    } catch (err) {
      console.error("Failed to open Farcaster cast composer", err);
      setError("Could not open the Farcaster cast composer.");
    } finally {
      setPending(null);
    }
  }

  return { canCompose, pending, error, share };
}
