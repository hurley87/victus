import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapButton,
  snapOpenMiniAppEntry,
  snapStack,
  snapText,
} from "./response";

export function buildOnboardingSnapResponse(params: {
  taunt: boolean;
  tauntUrl: string;
  miniAppWalletUrl: string;
}): SnapResponse {
  const { title, body, challenge } = params.taunt
    ? {
        title: "Still hiding from Commodus?",
        body: "No? Loud for someone still outside the gates. The arena keeps score, and Commodus keeps receipts.",
        challenge: "Enter now, or keep pretending the next reset changes you.",
      }
    : {
        title: "Commodus is still undefeated",
        body: "Victus is the game: mint your arena wallet, enter the arena, and try to beat Commodus before he turns your rank into background noise.",
        challenge: "Ready to enter the arena?",
      };

  const elements = buildElementMap([
    snapStack("root", ["title", "body", "challenge", "actions", "open_app"], {
      gap: "md",
    }),
    snapText("title", title, { weight: "bold", size: "md" }),
    snapText("body", body, { size: "sm" }),
    snapText("challenge", challenge, { weight: "bold", size: "sm" }),
    snapStack("actions", ["yes", "no"], {
      direction: "horizontal",
      gap: "sm",
    }),
    snapButton(
      "yes",
      "I will fight",
      {
        action: "open_mini_app",
        params: { target: params.miniAppWalletUrl },
      },
      { variant: "primary", icon: "wallet" },
    ),
    snapButton(
      "no",
      "I fear Commodus",
      {
        action: "open_snap",
        params: { target: params.tauntUrl },
      },
      { variant: "secondary" },
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
