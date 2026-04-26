export const USER_QUERY_KEY = ["user-query"] as const;

export function isSessionRefreshEligibleApiUrl(url: string): boolean {
  if (!url.startsWith("/api/")) return false;
  return url !== "/api/auth/sign-in" && !url.startsWith("/api/auth/sign-in?");
}
