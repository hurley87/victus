import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { supabaseAdmin } from "@/lib/supabase/server";

import {
  REFERRAL_AWARD_POINTS,
  awardReferralForFirstFunding,
  recordReferralSignup,
} from "./service";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/commodus/deep-links", () => ({
  appBaseUrl: () => "https://app.test",
  referralDeepLink: (fid: number) => `https://app.test/?tab=standings&ref=${fid}`,
}));

vi.mock("@/lib/scoring/dates", () => ({
  utcCurrentMonthString: () => "2026-04",
  utcMonthFromTimestamp: () => "2026-04",
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

describe("referral service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores self-referrals before touching the database", async () => {
    await recordReferralSignup({
      referrerFid: 100,
      referredFid: 100,
      referredUserId: "user-100",
    });

    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("ignores referrals from unknown accounts", async () => {
    const from = supabaseAdmin.from as unknown as Mock;
    from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    await recordReferralSignup({
      referrerFid: 100,
      referredFid: 200,
      referredUserId: "user-200",
    });

    expect(from).toHaveBeenCalledTimes(1);
  });

  it("persists one referral for a valid new signup", async () => {
    const referralInsert = vi.fn().mockResolvedValue({ error: null });
    const from = supabaseAdmin.from as unknown as Mock;
    from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { user_id: "referrer-user" },
          error: null,
        }),
      })
      .mockReturnValueOnce({ insert: referralInsert });

    await recordReferralSignup({
      referrerFid: 100,
      referredFid: 200,
      referredUserId: "user-200",
    });

    expect(referralInsert).toHaveBeenCalledWith({
      referrer_user_id: "referrer-user",
      referred_user_id: "user-200",
      referrer_fid: 100,
      referred_fid: 200,
    });
  });

  it("awards first-funding points idempotently through an awarded_at guard", async () => {
    const isGuard = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockReturnValue({ is: isGuard });
    const update = vi.fn().mockReturnValue({ eq });
    const from = supabaseAdmin.from as unknown as Mock;
    from.mockReturnValueOnce({ update });

    await awardReferralForFirstFunding({
      referredUserId: "user-200",
      fundedAt: "2026-04-25T12:00:00.000Z",
    });

    expect(update).toHaveBeenCalledWith({
      first_funded_at: "2026-04-25T12:00:00.000Z",
      awarded_at: "2026-04-25T12:00:00.000Z",
      award_month: "2026-04",
      award_points: REFERRAL_AWARD_POINTS,
    });
    expect(eq).toHaveBeenCalledWith("referred_user_id", "user-200");
    expect(isGuard).toHaveBeenCalledWith("awarded_at", null);
  });
});
