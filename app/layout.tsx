import Providers from "@/components/providers";
import { env } from "@/lib/env";
import {
  buildMiniAppPageMetadata,
  MINI_APP_METADATA,
} from "@/lib/miniapp-metadata";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Cinzel, Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const cinzel = Cinzel({ subsets: ["latin"], weight: ["700"], variable: "--font-cinzel" });

const { base: appUrl, feedImageUrl, embed } = buildMiniAppPageMetadata(
  env.NEXT_PUBLIC_URL,
);

export function generateMetadata(): Metadata {
  return {
    title: MINI_APP_METADATA.name,
    description: MINI_APP_METADATA.description,
    metadataBase: new URL(appUrl),
    openGraph: {
      title: MINI_APP_METADATA.ogTitle,
      description: MINI_APP_METADATA.description,
      type: "website",
      images: [{ url: feedImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: MINI_APP_METADATA.ogTitle,
      description: MINI_APP_METADATA.ogDescription,
      siteId: "1727435024931094528",
      creator: "@builders_garden",
      creatorId: "1727435024931094528",
      images: [feedImageUrl],
    },
    other: {
      "fc:miniapp": JSON.stringify(embed),
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
      <body className={`${inter.className} ${cinzel.variable}`}>
        <Providers cookie={cookie}>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
