import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapButton,
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
        body: "No? Rome expected louder courage. The arena keeps score, and Commodus grows fat on every challenger who will not enter.",
        challenge: "Wilt thou keep trembling, or finally answer the games?",
      }
    : {
        title: "Commodus waits undefeated",
        body: "Victus is the game: mint thy arena wallet, enter the sands, and try to beat Commodus before he buries thy rank.",
        challenge: "Art thou ready to fight in the Victus games?",
      };

  const elements = buildElementMap([
    snapStack("root", ["title", "body", "challenge", "actions"], {
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
