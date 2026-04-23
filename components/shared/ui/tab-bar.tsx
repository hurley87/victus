"use client";

import type { ComponentType } from "react";
import { useFarcaster } from "@/contexts/farcaster-context";
import { WalletIcon, TradeIcon, StandingsIcon } from "@/components/shared/icons/tab-icons";
import { cn } from "@/lib/utils";

export type Tab = "wallet" | "trade" | "standings";

function isTab(value: string): value is Tab {
  return value === "wallet" || value === "trade" || value === "standings";
}

/** Deep-link tab from `?tab=` (defaults to wallet). */
export function tabFromSearchParam(raw: string | null): Tab {
  return raw && isTab(raw) ? raw : "wallet";
}

type TabBarProps = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
};

const TABS: { id: Tab; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: "wallet", label: "Wallet", Icon: WalletIcon },
  { id: "trade", label: "Trade", Icon: TradeIcon },
  { id: "standings", label: "Standings", Icon: StandingsIcon },
];

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const { safeAreaInsets } = useFarcaster();
  const bottomInset = safeAreaInsets?.bottom ?? 0;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-gold/20 bg-imperial-surface/95 shadow-[0_-12px_32px_rgba(0,0,0,0.35)] backdrop-blur-sm"
      style={{ paddingBottom: bottomInset }}
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={cn(
                "flex flex-1 flex-col items-center gap-1.5 py-3.5 text-xs font-medium transition-all",
                isActive ? "text-gold" : "text-zinc-500"
              )}
            >
              <Icon className={cn("size-6 shrink-0", isActive && "scale-105")} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
