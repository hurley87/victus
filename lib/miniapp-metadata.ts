export const MINI_APP_METADATA = {
  name: "Victus Imperium",
  subtitle: "Farcaster trading game",
  description:
    "Compete in a public trading arena on Farcaster. Fund once, cast commands to Commodus, and climb monthly standings on Base.",
  primaryCategory: "games",
  tags: ["trading", "competition", "base", "farcaster", "arena"],
  tagline: "Trade for arena glory",
  ogTitle: "Victus Imperium",
  ogDescription:
    "Compete in a public trading arena on Farcaster and climb the monthly standings.",
  requiredChains: ["eip155:8453"],
  requiredCapabilities: ["wallet.getEthereumProvider", "actions.composeCast"],
  buttonTitle: "Enter Arena",
  splashBackgroundColor: "#0D0D0D",
  iconPath: "/images/icon.png",
  splashPath: "/images/splash.png",
  feedPath: "/images/feed.png",
  screenshotPaths: [
    "/images/screenshots/1.png",
    "/images/screenshots/2.png",
    "/images/screenshots/3.png",
  ],
} as const;

const TUNNEL_HOST_MARKERS = [
  "ngrok",
  "trycloudflare.com",
  "loca.lt",
  "localtunnel",
] as const;

function normalizeUrl(appUrl: string) {
  return appUrl.replace(/\/+$/, "");
}

function buildAssetUrls(appUrl: string) {
  const base = normalizeUrl(appUrl);
  const asset = (path: string) => `${base}${path}`;

  return {
    base,
    iconUrl: asset(MINI_APP_METADATA.iconPath),
    splashImageUrl: asset(MINI_APP_METADATA.splashPath),
    feedImageUrl: asset(MINI_APP_METADATA.feedPath),
    webhookUrl: asset("/api/webhook"),
    screenshotUrls: MINI_APP_METADATA.screenshotPaths.map(asset),
  };
}

function describeHost(appUrl: string): { suffix: string | null; noindex: boolean } {
  if (appUrl.includes("localhost")) return { suffix: "Local", noindex: true };
  if (appUrl.includes("ngrok")) return { suffix: "NGROK", noindex: true };
  if (TUNNEL_HOST_MARKERS.some((marker) => appUrl.includes(marker))) {
    return { suffix: "Tunnel", noindex: true };
  }
  if (appUrl.includes("https://dev.")) return { suffix: "Dev", noindex: true };
  return { suffix: null, noindex: false };
}

function nameForSuffix(suffix: string | null) {
  return suffix ? `${MINI_APP_METADATA.name} ${suffix}` : MINI_APP_METADATA.name;
}

/**
 * Builds the values `app/layout.tsx` needs to populate `<head>` metadata and
 * the `fc:miniapp` embed tag in a single pass over the app URL.
 */
export function buildMiniAppPageMetadata(appUrl: string) {
  const { base, feedImageUrl, splashImageUrl } = buildAssetUrls(appUrl);
  const { suffix } = describeHost(base);

  return {
    base,
    feedImageUrl,
    embed: {
      version: "1",
      imageUrl: feedImageUrl,
      button: {
        title: MINI_APP_METADATA.buttonTitle,
        action: {
          type: "launch_miniapp",
          name: nameForSuffix(suffix),
          url: base,
          splashImageUrl,
          splashBackgroundColor: MINI_APP_METADATA.splashBackgroundColor,
        },
      },
    },
  };
}

/**
 * Builds the `frame` / `miniapp` payload served from
 * `/.well-known/farcaster.json`.
 */
export function buildFarcasterMiniAppConfig(appUrl: string) {
  const assets = buildAssetUrls(appUrl);
  const { suffix, noindex } = describeHost(assets.base);
  const name = nameForSuffix(suffix);

  return {
    version: "1",
    name,
    iconUrl: assets.iconUrl,
    homeUrl: assets.base,
    imageUrl: assets.feedImageUrl,
    buttonTitle: MINI_APP_METADATA.buttonTitle,
    splashImageUrl: assets.splashImageUrl,
    splashBackgroundColor: MINI_APP_METADATA.splashBackgroundColor,
    webhookUrl: assets.webhookUrl,
    subtitle: MINI_APP_METADATA.subtitle,
    description: MINI_APP_METADATA.description,
    primaryCategory: MINI_APP_METADATA.primaryCategory,
    tags: [...MINI_APP_METADATA.tags],
    tagline: MINI_APP_METADATA.tagline,
    ogTitle: name,
    ogDescription: MINI_APP_METADATA.ogDescription,
    screenshotUrls: assets.screenshotUrls,
    heroImageUrl: assets.feedImageUrl,
    ogImageUrl: assets.feedImageUrl,
    noindex,
    requiredChains: [...MINI_APP_METADATA.requiredChains],
    requiredCapabilities: [...MINI_APP_METADATA.requiredCapabilities],
  };
}
