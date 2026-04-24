import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapButton,
  snapStack,
  snapText,
} from "./response";

export const ONBOARDING_SALUTE_TEXT = "For those about to die, we salute you!";

export function buildOnboardingSnapResponse(params: {
  taunt: boolean;
  tauntUrl: string;
  miniAppWalletUrl: string;
}): SnapResponse {
  const title = params.taunt
    ? "Still hiding from Commodus?"
    : "Commodus waits undefeated";
  const body = params.taunt
    ? "No? Rome expected louder courage. The arena keeps score, and Commodus grows fat on every challenger who will not enter."
    : "Victus is the game: mint thy arena wallet, enter the sands, and try to beat Commodus before he buries thy rank.";
  const challenge = params.taunt
    ? "Wilt thou keep trembling, or finally answer the games?"
    : "Art thou ready to fight in the Victus games?";

  const elements = buildElementMap([
    snapStack("root", ["title", "body", "challenge", "actions", "wallet"], {
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
        action: "compose_cast",
        params: {
          text: ONBOARDING_SALUTE_TEXT,
          embeds: [params.miniAppWalletUrl],
        },
      },
      { variant: "primary", icon: "share" },
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
    snapButton(
      "wallet",
      "Enter Mini App",
      {
        action: "open_mini_app",
        params: { target: params.miniAppWalletUrl },
      },
      { variant: "secondary", icon: "wallet" },
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
