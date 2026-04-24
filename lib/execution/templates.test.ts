import { describe, expect, it } from "vitest";

import {
  buildIntentReply,
  NO_WALLET_ONBOARDING_REPLY,
  buildOutcomeReply,
  POLICY_REJECTION_COPY,
  REJECTION_REPLIES,
  policyRejectionMessage,
} from "./templates";

const voice = { gladiatorName: "Maximus" };

describe("buildIntentReply", () => {
  it("renders a buy order with the notional and symbol", () => {
    const text = buildIntentReply(
      {
        action: "buy",
        symbol: "AERO",
        amount_type: "usdc_in",
        amount_value: 5,
      },
      voice,
    );
    expect(text).toContain("5");
    expect(text).toContain("AERO");
    expect(text).toContain("Maximus");
    expect(text.toLowerCase()).toMatch(/moving|usdc/);
  });

  it("switches verb on sell intents", () => {
    const text = buildIntentReply(
      {
        action: "sell",
        symbol: "AERO",
        amount_type: "percent_out",
        amount_value: 50,
      },
      voice,
    );
    expect(text).toContain("selling");
    expect(text).toContain("50%");
    expect(text).toContain("AERO");
  });
});

describe("buildOutcomeReply", () => {
  it("includes quantity + notional + BaseScan transaction URL on success", () => {
    const txHash = "0x0123456789abcdef0123456789abcdef";
    const text = buildOutcomeReply(
      {
        kind: "success",
        action: "buy",
        symbol: "AERO",
        quantity: 12.34567,
        notionalUsdc: 4.95,
        txHash,
      },
      voice,
    );
    expect(text).toContain("AERO");
    expect(text).toContain("12.34567");
    expect(text).toContain("4.95");
    expect(text).toContain(`https://basescan.org/tx/${txHash}`);
    expect(text).not.toContain("Proof:");
    expect(text).toContain("Maximus");
  });

  it("renders templated voice for a failed trade", () => {
    const text = buildOutcomeReply(
      { kind: "failure", reason: "revert" },
      { gladiatorName: "" },
    );
    expect(text.toLowerCase()).toMatch(/trade|onchain|failed/);
  });
});

describe("POLICY_REJECTION_COPY", () => {
  it("covers every rejection reason in the policy union", () => {
    expect(POLICY_REJECTION_COPY.needs_gladiator_mint).toBeTruthy();
    expect(POLICY_REJECTION_COPY.asset_not_whitelisted).toBeTruthy();
    expect(POLICY_REJECTION_COPY.max_trades_per_day).toBeTruthy();
    expect(POLICY_REJECTION_COPY.max_trade_usdc).toBeTruthy();
    expect(POLICY_REJECTION_COPY.wallet_cap_usdc).toBeTruthy();
    expect(POLICY_REJECTION_COPY.insufficient_balance).toBeTruthy();
  });

  it("interpolates live caps for max_trade_usdc", () => {
    const text = policyRejectionMessage("max_trade_usdc", { maxTradeUsdc: 25 });
    expect(text).toContain("25");
  });

  it("uses competitive onboarding copy for no-wallet users", () => {
    expect(policyRejectionMessage("needs_gladiator_mint")).toBe(
      NO_WALLET_ONBOARDING_REPLY,
    );
    expect(REJECTION_REPLIES.no_arena_wallet).toBe(NO_WALLET_ONBOARDING_REPLY);
    expect(NO_WALLET_ONBOARDING_REPLY).toMatch(/Commodus/i);
    expect(NO_WALLET_ONBOARDING_REPLY).toMatch(/Mini App/i);
    expect(NO_WALLET_ONBOARDING_REPLY).toMatch(/beat/i);
  });

  it("includes realized PnL on sell success outcomes", () => {
    const text = buildOutcomeReply(
      {
        kind: "success",
        action: "sell",
        symbol: "AERO",
        quantity: 2,
        notionalUsdc: 10,
        txHash: "0x0123456789abcdef0123456789abcdef",
        realizedPnlUsdc: 1.25,
      },
      voice,
    );
    expect(text).toContain("Executed");
    expect(text).toContain("Realized PnL");
    expect(text).toContain("1.25");
    expect(text).toContain("USDC");
  });
});
