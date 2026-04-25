import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapButton,
  snapOpenMiniAppEntry,
  snapStack,
  snapText,
} from "./response";

export function buildOnboardingSnapResponse(params: {
  miniAppWalletUrl: string;
}): SnapResponse {
  const title = "Fund your wallet";
  const body =
    "Fund your wallet, make trades in the arena, and beat Commodus to earn rewards.";

  const elements = buildElementMap([
    snapStack("root", ["title", "body", "fund", "open_app"], {
      gap: "md",
    }),
    snapText("title", title, { weight: "bold", size: "md" }),
    snapText("body", body, { size: "sm" }),
    snapButton(
      "fund",
      "Fund wallet",
      {
        action: "open_mini_app",
        params: { target: params.miniAppWalletUrl },
      },
      { variant: "primary", icon: "wallet" },
    ),
    snapOpenMiniAppEntry(params.miniAppWalletUrl),
  ]);

  return {
    version: "2.0",
    theme: { accent: "red" },
    ui: {
      root: "root",
      elements,
    },
  };
}
