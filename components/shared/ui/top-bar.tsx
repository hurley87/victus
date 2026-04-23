"use client";

import { useUser } from "@/contexts/user-context";
import { useFarcaster } from "@/contexts/farcaster-context";
import Image from "next/image";

export function TopBar() {
  const { user } = useUser();
  const { safeAreaInsets } = useFarcaster();
  const topInset = safeAreaInsets?.top ?? 0;

  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 bg-imperial-bg/95 backdrop-blur-sm"
      style={{ paddingTop: Math.max(topInset, 8) + 8, paddingBottom: 8 }}
    >
      {/* Helmet logo */}
      <Image
        src="/header.png"
        alt="Victus Imperium"
        width={28}
        height={28}
        className="size-7 rounded"
      />

      {/* User avatar */}
      <div className="size-8 rounded-full overflow-hidden border border-gold/30 bg-imperial-surface">
        {user?.data?.pfp_url ? (
          <Image
            src={user.data.pfp_url}
            alt={user.data.display_name ?? "Profile"}
            width={32}
            height={32}
            className="size-full object-cover"
          />
        ) : (
          <div className="size-full bg-imperial-surface" />
        )}
      </div>
    </header>
  );
}
