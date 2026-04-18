"use client";

import { useEnvironment } from "@/contexts/environment-context";
import { useFarcaster } from "@/contexts/farcaster-context";
import { useUser } from "@/contexts/user-context";
import { env } from "@/lib/env";
import Image from "next/image";
import { useAccount } from "wagmi";
import { Website } from "../website";

export default function HomePage() {
  const { user, isLoading, error, signIn, isSignedIn } = useUser();
  const { address } = useAccount();
  const { isInBrowser } = useEnvironment();
  const { context } = useFarcaster();
  const isInFarcasterMobile =
    !isInBrowser && context?.client?.platformType === "mobile";

  const baseUrl = isInFarcasterMobile
    ? `cbwallet://miniapp?url=${encodeURIComponent(env.NEXT_PUBLIC_URL)}`
    : env.NEXT_PUBLIC_URL;

  if (isInBrowser) {
    return <Website />;
  }

  if (isSignedIn && !user) {
    return <div>You are not authorized to view this page</div>;
  }

  return (
    <div className="bg-white text-black flex min-h-screen flex-col items-center justify-center p-4">
      <div className="text-center space-y-4">
        {user?.data ? (
          <p
            className="text-2xl font-semibold"
            data-testid="welcome-line"
          >
            Welcome, @{user.data.username} (FID: {user.data.fid})
          </p>
        ) : (
          <h1 className="text-4xl font-bold">Welcome</h1>
        )}
        <p className="text-lg text-muted-foreground">
          {user?.data ? "You are signed in!" : "Sign in to get started"}
        </p>
        <p className="text-lg text-muted-foreground">
          {address
            ? `${address.substring(0, 6)}...${address.substring(
                address.length - 4
              )}`
            : "No address found"}
        </p>

        {!user?.data ? (
          <button
            onClick={signIn}
            disabled={isLoading}
            className="px-6 py-3 bg-purple-600 text-white font-semibold rounded-lg shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center justify-center space-x-2 min-w-[160px] min-h-[48px]"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                <span>Signing in...</span>
              </>
            ) : (
              "Sign in"
            )}
          </button>
        ) : (
          <div className="space-y-4">
            {user && (
              <div className="flex flex-col items-center space-y-2 min-h-[160px] justify-center">
                {user.isLoading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  </div>
                ) : (
                  <>
                    <Image
                      src={user.data.pfp_url!}
                      alt="Profile"
                      className="w-20 h-20 rounded-full"
                      width={80}
                      height={80}
                    />
                    <div className="text-center">
                      <p className="font-semibold">{user.data.display_name}</p>
                      <p className="text-sm text-muted-foreground">
                        @{user.data.username}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
