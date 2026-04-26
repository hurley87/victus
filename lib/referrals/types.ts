/**
 * Shared shapes for `/api/referrals/me` and client UI. Kept out of
 * `service.ts` so client components can import without pulling `server-only`.
 */
export type ReferralRecentUser = {
  fid: number;
  username: string | null;
  referredAt: string;
  firstFundedAt: string | null;
  awardedAt: string | null;
};

export type ReferralSummary = {
  referralUrl: string;
  signups: number;
  funded: number;
  seasonBonusPoints: number;
  bonusPointsPerFunding: number;
  recent: ReferralRecentUser[];
};
