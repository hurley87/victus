import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapButton,
  snapOpenMiniAppEntry,
  snapStack,
  snapText,
} from "./response";

export function buildSeasonEnterSnapResponse(params: {
  miniAppArenaUrl: string;
}): SnapResponse {
  const { miniAppArenaUrl: target } = params;
  const openArena = { action: "open_mini_app" as const, params: { target } };

  const elements = buildElementMap([
    snapStack("root", ["title", "body", "enter", "open_app"], {
      gap: "md",
    }),
    snapText("title", "Enter Victus week", { weight: "bold", size: "md" }),
    snapText(
      "body",
      "Join this week's arena to trade. You start with the same USDC balance as everyone else.",
      { size: "sm" },
    ),
    snapButton("enter", "Enter week", openArena, {
      variant: "primary",
      icon: "arrow-right",
    }),
    snapOpenMiniAppEntry(target),
  ]);

  return {
    version: "2.0",
    theme: { accent: "purple" },
    ui: {
      root: "root",
      elements,
    },
  };
}
