"use client";

import { useState } from "react";
import Image from "next/image";
import { useUser } from "@/contexts/user-context";
import { useFarcaster } from "@/contexts/farcaster-context";
import { TopBar } from "@/components/shared/ui/top-bar";
import { TabBar, type Tab } from "@/components/shared/ui/tab-bar";
import { Button } from "@/components/shared/ui/button";

import WalletTab from "@/components/pages/wallet";
import TradeTab from "@/components/pages/trade";
import StandingsTab from "@/components/pages/standings";

type ImperialShellProps = {
  initialTab?: Tab;
};

export function ImperialShell({ initialTab = "wallet" }: ImperialShellProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const { user, isSignedIn, signIn, isLoading: isSigningIn } = useUser();
  const { context, safeAreaInsets } = useFarcaster();

  // Still bootstrapping the Mini App SDK
  if (!context) {
    return <LoadingScreen />;
  }

  // Auth gate
  if (!isSignedIn || !user?.data) {
    return (
      <div className="min-h-screen bg-imperial-bg flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-4">
          <h1 className="font-serif text-2xl text-gold uppercase tracking-wider">
            Victus Imperium
          </h1>
          <p className="text-sm text-zinc-400 max-w-xs">
            A public trading game on Farcaster. Sign in to enter the arena.
          </p>
          <Button
            variant="imperial"
            size="lg"
            onClick={signIn}
            disabled={isSigningIn}
            className="min-w-[160px]"
          >
            {isSigningIn ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full size-4 border-2 border-imperial-bg border-t-transparent" />
                Signing in...
              </span>
            ) : (
              "Sign in"
            )}
          </Button>
        </div>
      </div>
    );
  }

  const topInset = safeAreaInsets?.top ?? 0;
  const bottomInset = safeAreaInsets?.bottom ?? 0;
  // Top bar: safe area + padding (8) + content (32) + padding (8) = safe area + 48
  const topPadding = topInset + 48;
  // Bottom tab bar: content (~52) + safe area
  const bottomPadding = bottomInset + 56;

  return (
    <div className="min-h-screen bg-imperial-bg">
      <TopBar />
      <main
        className="px-4"
        style={{ paddingTop: topPadding, paddingBottom: bottomPadding }}
      >
        {activeTab === "wallet" && <WalletTab />}
        {activeTab === "trade" && <TradeTab />}
        {activeTab === "standings" && <StandingsTab />}
      </main>
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="fixed inset-0">
      <Image
        src="/loading.png"
        alt=""
        fill
        className="object-cover"
        priority
      />
    </div>
  );
}
