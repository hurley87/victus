import { describe, expect, it } from "vitest";

import {
  buildIntentReply,
  buildOutcomeReply,
  POLICY_REJECTION_COPY,
} from "./templates";

describe("buildIntentReply", () => {
  it("renders a buy decree with the notional and symbol", () => {
    const text = buildIntentReply({
      action: "buy",
      symbol: "AERO",
      amount_type: "usdc_in",
      amount_value: 5,
    });
    expect(text).toContain("5");
    expect(text).toContain("AERO");
    expect(text).toContain("deploy");
  });

  it("switches verb on sell intents", () => {
    const text = buildIntentReply({
      action: "sell",
      symbol: "AERO",
      amount_type: "percent_out",
      amount_value: 100,
    });
    expect(text).toContain("retire");
  });
});

describe("buildOutcomeReply", () => {
  it("includes quantity + notional + short tx hash on success", () => {
    const text = buildOutcomeReply({
      kind: "success",
      symbol: "AERO",
      quantity: 12.34567,
      notionalUsdc: 4.95,
      txHash: "0x0123456789abcdef0123456789abcdef",
    });
    expect(text).toContain("AERO");
    expect(text).toContain("12.34567");
    expect(text).toContain("4.95");
    expect(text).toContain("0x01234567");
  });

  it("renders the failure reason for a failed trade", () => {
    const text = buildOutcomeReply({ kind: "failure", reason: "reverted" });
    expect(text).toContain("failed");
    expect(text).toContain("reverted");
  });
});

describe("POLICY_REJECTION_COPY", () => {
  it("covers every rejection reason in the policy union", () => {
    // Keep this list in sync with `PolicyRejectionReason`. A mismatch is
    // a compile error because the record type pins the keys.
    expect(POLICY_REJECTION_COPY.needs_gladiator_mint).toBeTruthy();
    expect(POLICY_REJECTION_COPY.asset_not_whitelisted).toBeTruthy();
    expect(POLICY_REJECTION_COPY.max_trades_per_day).toBeTruthy();
    expect(POLICY_REJECTION_COPY.max_trade_usdc).toBeTruthy();
    expect(POLICY_REJECTION_COPY.wallet_cap_usdc).toBeTruthy();
  });
});
