import { describe, expect, it } from "vitest";

import {
  buildOnboardingSnapResponse,
  ONBOARDING_SALUTE_TEXT,
} from "./build-onboarding-snap";

const baseParams = {
  taunt: false,
  tauntUrl: "https://app.example/api/snaps/onboarding/123?taunt=1",
  miniAppWalletUrl: "https://app.example/?tab=wallet",
};

describe("buildOnboardingSnapResponse", () => {
  it("returns Snap 2.0 with initial yes/no onboarding choices", () => {
    const snap = buildOnboardingSnapResponse(baseParams);
    expect(snap.version).toBe("2.0");
    expect(snap.ui.root).toBe("root");
    const { elements } = snap.ui;

    expect(elements.root?.type).toBe("stack");
    expect(elements.root?.children?.length).toBeLessThanOrEqual(7);
    expect(Object.keys(elements).length).toBeLessThanOrEqual(64);

    expect(elements.yes?.on?.press?.action).toBe("compose_cast");
    expect(elements.yes?.on?.press?.params).toEqual({
      text: ONBOARDING_SALUTE_TEXT,
      embeds: ["https://app.example/?tab=wallet"],
    });

    expect(elements.no?.on?.press?.action).toBe("open_snap");
    expect(elements.no?.on?.press?.params).toEqual({
      target: "https://app.example/api/snaps/onboarding/123?taunt=1",
    });
  });

  it("keeps taunting without dead-ending after a no choice", () => {
    const snap = buildOnboardingSnapResponse({ ...baseParams, taunt: true });
    const { elements } = snap.ui;

    expect(elements.title?.props?.content).toMatch(/hiding/i);
    expect(elements.yes?.on?.press?.action).toBe("compose_cast");
    expect(elements.no?.on?.press?.action).toBe("open_snap");
    expect(elements.no?.on?.press?.params).toEqual({
      target: "https://app.example/api/snaps/onboarding/123?taunt=1",
    });
    expect(elements.wallet?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: "https://app.example/?tab=wallet" },
    });
  });
});
