import { describe, expect, it } from "vitest";

import {
  buildStandingsSnapResponse,
  type StandingsSnapContext,
} from "./build-standings-snap";

const links = {
  tradeSnap: "https://app.example/api/snaps/trade-command",
  standingsSnap: "https://app.example/api/snaps/standings/123",
  miniApp: "https://app.example/?tab=standings",
  walletMiniApp: "https://app.example/?tab=wallet",
};

describe("buildStandingsSnapResponse", () => {
  it("renders top five plus an out-of-top-five user row", () => {
    const ctx: StandingsSnapContext = {
      displayHandle: "Maximus",
      entries: [
        { rank: 1, label: "Aurelius", points: 100, isUser: false },
        { rank: 2, label: "Lucilla", points: 90, isUser: false },
        { rank: 3, label: "Cassius", points: 80, isUser: false },
        { rank: 4, label: "Crispus", points: 70, isUser: false },
        { rank: 5, label: "Nerva", points: 60, isUser: false },
        { rank: 12, label: "Maximus", points: 40, isUser: true },
      ],
    };

    const snap = buildStandingsSnapResponse(ctx, links);
    const { elements } = snap.ui;

    expect(snap.version).toBe("2.0");
    expect(elements.root?.children?.length).toBeLessThanOrEqual(7);
    expect(elements.standings?.children?.length).toBe(6);
    expect(Object.keys(elements).length).toBeLessThanOrEqual(64);
    expect(elements.i_0?.props?.title).toBe("#1 Aurelius");
    expect(elements.i_5?.props?.title).toBe("#12 Maximus (you)");
    expect(elements.act_trade?.on?.press).toEqual({
      action: "open_snap",
      params: { target: links.tradeSnap },
    });
    expect(elements.open_app?.on?.press).toEqual({
      action: "open_mini_app",
      params: { target: links.miniApp },
    });
  });

  it("marks the user in the top five without adding a duplicate row", () => {
    const snap = buildStandingsSnapResponse(
      {
        displayHandle: "Maximus",
        entries: [
          { rank: 1, label: "Aurelius", points: 100, isUser: false },
          { rank: 2, label: "Maximus", points: 90, isUser: true },
        ],
      },
      links,
    );

    const { elements } = snap.ui;
    expect(elements.standings?.children?.length).toBe(2);
    expect(elements.i_1?.props?.title).toBe("#2 Maximus (you)");
  });
});
