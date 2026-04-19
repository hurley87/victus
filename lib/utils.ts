import { type ClassValue, clsx } from "clsx";
import { formatDistance } from "date-fns";
import ky from "ky";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names
 * @param inputs - Class names to merge
 * @returns Merged class names
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Check if an image is valid client-side
 * @param imageSrc - The source of the image
 * @returns True if the image is valid, false otherwise
 */
export const checkImage = async (imageSrc: string): Promise<boolean> =>
  new Promise((resolve) => {
    const image = new window.Image();
    image.src = imageSrc ?? "";
    image.alt = "Participant Image";
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
  });

/**
 * Validate an image URL server-side
 * @param url - The URL of the image
 * @returns The URL if the image is valid, null otherwise
 */
export const validateImageUrl = async (url: string): Promise<string | null> => {
  try {
    await ky.head(url);
    return url;
  } catch {
    return null;
  }
};

/**
 * Formats a number with 'k' for thousands and 'M' for millions
 * @param value - The number to format
 * @param decimals - Number of decimal places to show (default: 2)
 * @returns Formatted string with appropriate suffix
 *
 * Examples:
 * formatNumberWithSuffix(1234) => "1.23k"
 * formatNumberWithSuffix(1234567) => "1.23M"
 */
/** USDC (or dollar) amounts for display in Mini App tables and portfolio. */
export function formatUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export const formatNumberWithSuffix = (value: number, decimals = 2): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0";
  }

  // For values less than 1000, just return the number with fixed decimals
  if (Math.abs(value) < 1000) {
    return value.toFixed(decimals);
  }

  // For thousands (k)
  if (Math.abs(value) < 1_000_000) {
    return `${(value / 1000).toFixed(decimals)}k`;
  }

  // For millions (M)
  return `${(value / 1_000_000).toFixed(decimals)}M`;
};

/**
 * Format the avatar src for imagedelivery.net images to reasonable avatar sizes
 *
 * @docs https://developers.cloudflare.com/images/transform-images/transform-via-url/#options
 *
 * @param avatarSrc - The src of the avatar
 * @returns The formatted avatar src
 */
export const formatAvatarSrc = (url: string) => {
  let avatarSrc = url;
  if (avatarSrc.startsWith("https://imagedelivery.net")) {
    const defaultAvatar = "/anim=false,fit=contain,f=auto,w=512";
    if (avatarSrc.endsWith("/rectcrop3")) {
      avatarSrc = avatarSrc.replace("/rectcrop3", defaultAvatar);
    } else if (avatarSrc.endsWith("/original")) {
      avatarSrc = avatarSrc.replace("/original", defaultAvatar);
    } else if (avatarSrc.endsWith("/public")) {
      avatarSrc = avatarSrc.replace("/public", defaultAvatar);
    }
  }
  return avatarSrc;
};

/**
 * Copy text to clipboard
 * @param text - The text to copy
 * @param setIsCopied - The function to set the show copied state
 */
export const copyToClipboard = async (
  text: string | undefined,
  setIsCopied: React.Dispatch<React.SetStateAction<boolean>>
) => {
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 750);
  } catch (_err) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);

    textArea.select();
    try {
      document.execCommand("copy");
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 750);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }

    document.body.removeChild(textArea);
  }
};

/**
 * Create a twitter intent url to open a prefilled tweet
 * @param text - The text of the tweet
 * @param miniappUrl - The url of the miniapp
 * @returns The twitter intent url
 */
export const createTwitterIntentUrl = (text: string, miniappUrl: string) => {
  const finalURL = `https://x.com/intent/tweet?text=${encodeURIComponent(
    text
  )}&url=${encodeURIComponent(miniappUrl)}&via=builders_garden`;
  return finalURL;
};

/**
 * Format a wallet address to a more readable format
 * @param address - The wallet address
 * @returns The formatted wallet address
 */
export const formatWalletAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(address.length - 4)}`;

/**
 * Format a date into a short relative time (e.g. 5m ago, 2h ago, 3d ago).
 * Keeps output compact for UI badges. Falls back to empty string if invalid.
 * @param input - Date object, timestamp, or date string
 * @param now - (internal) reference time for testing/override
 */
export function formatTimeAgo(input: Date | string | number): string {
  return formatDistance(input, new Date(), {
    addSuffix: true,
  });
}

/**
 * Get the initials of a name
 * @param name - The name to get the initials of
 * @returns The initials of the name
 */
export function getInitials(name: string): string {
  if (!name) {
    return "";
  }

  return name
    .replace(/\s+/g, " ")
    .split(" ")
    .slice(0, 2)
    .map((v) => v?.[0]?.toUpperCase())
    .join("");
}
