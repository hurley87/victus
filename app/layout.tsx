import Providers from "@/components/providers";
import { env } from "@/lib/env";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

const appUrl = env.NEXT_PUBLIC_URL;
const appName = "Mini-app Starter";
const appDescription = "A starter for Farcaster Mini-apps";

export function generateMetadata(): Metadata {
  return {
    title: `${appName} by Builders Garden`,
    description: appDescription,
    metadataBase: new URL(appUrl),
    openGraph: {
      title: `${appName} by Builders Garden`,
      description: appDescription,
      type: "website",
      images: [
        {
          url: `${appUrl}/images/feed.png`,
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${appName} by Builders Garden`,
      description: appDescription,
      siteId: "1727435024931094528",
      creator: "@builders_garden",
      creatorId: "1727435024931094528",
      images: [`${appUrl}/images/feed.png`],
    },
    other: {
      "fc:miniapp": JSON.stringify({
        version: "next",
        imageUrl: `${appUrl}/images/feed.png`,
        button: {
          title: "Launch App",
          action: {
            type: "launch_miniapp",
            name: appName,
            url: appUrl,
            splashImageUrl: `${appUrl}/images/splash.png`,
            splashBackgroundColor: "#ffffff",
          },
        },
      }),
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookie = (await headers()).get("cookie");
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers cookie={cookie}>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
