import { describe, expect, it } from "vitest";

import { buildOnboardingSnapResponse } from "./build-onboarding-snap";

const baseParams = {
  miniAppWalletUrl: "https://app.example/?tab=wallet",
};

describe("buildOnboardingSnapResponse", () => {
  it("returns Snap 2.0 with a fund-wallet onboarding CTA", () => {
    const snap = buildOnboardingSnapResponse(baseParams);
    expect(snap.version).toBe("2.0");
    expect(snap.ui.root).toBe("root");
    const { elements } = snap.ui;

    expect(elements.root?.type).toBe("stack");
    expect(elements.root?.children).toEqual(["title", "body", "fund", "open_app"]);
    expect(Object.keys(elements).length).toBe(5);

    expect(elements.title?.props?.content).toBe("Fund your wallet");
    expect(elements.body?.props?.content).toMatch(/beat Commodus/i);
    expect(elements.fund?.props?.label).toBe("Fund wallet");
    expect(elements.fund?.on?.press?.action).toBe("open_mini_app");
    expect(elements.fund?.on?.press?.params).toEqual({
      target: baseParams.miniAppWalletUrl,
    });
    expect(elements.open_app?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: baseParams.miniAppWalletUrl },
    });
  });
});
