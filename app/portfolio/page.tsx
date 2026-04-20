import { Suspense } from "react";

import PortfolioPage from "@/components/pages/portfolio";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white text-black">
          Loading portfolio…
        </div>
      }
    >
      <PortfolioPage />
    </Suspense>
  );
}
