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
      className="fixed bottom-0 left-0 right-0 z-40 bg-imperial-surface border-t border-gold/20"
      style={{ paddingBottom: bottomInset }}
    >
      <div className="flex">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
                isActive ? "text-gold" : "text-zinc-500"
              )}
            >
              <Icon className="size-5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
