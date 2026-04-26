import { describe, expect, it } from "vitest";

import { buildSeasonEnterSnapResponse } from "./build-season-enter-snap";

describe("buildSeasonEnterSnapResponse", () => {
  it("roots Enter week on open_mini_app to the arena URL", () => {
    const snap = buildSeasonEnterSnapResponse({
      miniAppArenaUrl: "https://app.example/arena",
    });
    expect(snap.version).toBe("2.0");
    expect(snap.ui.root).toBe("root");
    const enter = snap.ui.elements.enter;
    expect(enter?.on?.press?.action).toBe("open_mini_app");
    expect(enter?.on?.press?.params).toEqual({
      target: "https://app.example/arena",
    });
    expect(snap.ui.elements.open_app?.on?.press?.params).toEqual({
      target: "https://app.example/arena",
    });
  });
});
