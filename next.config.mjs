import { fileURLToPath } from "node:url";
import createJiti from "jiti";
import { createSecureHeaders } from "next-secure-headers";
import { withWorkflow } from "workflow/next";

const jiti = createJiti(fileURLToPath(import.meta.url));

// Import env here to validate during build. Using jiti@^1 we can import .ts files :)
jiti("./lib/env");

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  reactStrictMode: true,
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
  turbopack: {
    root: process.cwd(),
  },
  // Dev-only: Snap emulator / Farcaster clients fetch snaps from a tunnel URL with
  // Origin: https://farcaster.xyz — Next blocks unknown dev origins unless listed.
  allowedDevOrigins: [
    "http://localhost:3000",
    new URL(process.env.NEXT_PUBLIC_URL).hostname,
    "farcaster.xyz",
    "*.farcaster.xyz",
    "warpcast.com",
    "*.warpcast.com",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  headers() {
    return [
      {
        locale: false,
        source: "/(.*)",
        headers: createSecureHeaders({
          frameGuard: false,
          noopen: "noopen",
          nosniff: "nosniff",
          xssProtection: "sanitize",
          forceHTTPSRedirect: [
            true,
            { maxAge: 60 * 60 * 24 * 360, includeSubDomains: true },
          ],
          referrerPolicy: "same-origin",
          contentSecurityPolicy: {
            directives: {
              connectSrc: ["*"],
            },
          },
        }),
      },
    ];
  },
};

export default withWorkflow(nextConfig);
