"use client";

import { Suspense } from "react";
import { useEnvironment } from "@/contexts/environment-context";
import { useSearchParams } from "next/navigation";
import { Website } from "../website";
import { ImperialShell } from "@/components/shared/imperial-shell";
import { tabFromSearchParam } from "@/components/shared/ui/tab-bar";

function HomeInner() {
  const { isInBrowser } = useEnvironment();
  const searchParams = useSearchParams();

  if (isInBrowser) {
    return <Website />;
  }

  return <ImperialShell initialTab={tabFromSearchParam(searchParams.get("tab"))} />;
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-imperial-bg flex items-center justify-center">
          <p className="text-sm text-zinc-500">Loading...</p>
        </div>
      }
    >
      <HomeInner />
    </Suspense>
  );
}
