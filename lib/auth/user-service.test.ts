import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { recordReferralSignup } from "@/lib/referrals/service";
import { supabaseAdmin } from "@/lib/supabase/server";

import { resolveOrCreateFarcasterUser } from "./user-service";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/referrals/service", () => ({
  recordReferralSignup: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

const profile = {
  fid: "200",
  username: "new-player",
  display_name: "New Player",
  pfp_url: "",
  custody_address: "0x0000000000000000000000000000000000000000",
  verifications: [],
};

describe("resolveOrCreateFarcasterUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not rewrite referral attribution for an existing user", async () => {
    const from = supabaseAdmin.from as unknown as Mock;
    from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { user_id: "existing-user" },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

    const userId = await resolveOrCreateFarcasterUser(200, profile, 100);

    expect(userId).toBe("existing-user");
    expect(recordReferralSignup).not.toHaveBeenCalled();
  });

  it("records referral attribution for a newly created user", async () => {
    const from = supabaseAdmin.from as unknown as Mock;
    from
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: "new-user" },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ error: null }),
      });

    const userId = await resolveOrCreateFarcasterUser(200, profile, 100);

    expect(userId).toBe("new-user");
    expect(recordReferralSignup).toHaveBeenCalledWith({
      referrerFid: 100,
      referredFid: 200,
      referredUserId: "new-user",
    });
  });
});
