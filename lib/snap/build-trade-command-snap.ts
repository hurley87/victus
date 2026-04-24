import { COMMAND_BOT_HANDLE } from "@/lib/commodus/bot";

import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapButton,
  snapItem,
  snapItemGroup,
  snapOpenMiniAppEntry,
  snapStack,
  snapText,
} from "./response";

export type TradeCommandSnapContext = {
  starterCommand: string;
  buyExample: string;
  sellExample: string;
};

export type StandingsPress =
  | { action: "open_snap"; target: string }
  | { action: "open_mini_app"; target: string };

export type TradeCommandSnapLinks = {
  standings: StandingsPress;
  walletMiniApp: string;
  miniApp: string;
};

/**
 * Compose-first trade command snap. The primary button fires
 * {@link https://docs.farcaster.xyz/snap/actions#compose_cast compose_cast}
 * directly — no `submit` round-trip and no signed form data, because
 * compose_cast params don't interpolate field values anyway.
 */
export function buildTradeCommandSnapResponse(
  ctx: TradeCommandSnapContext,
  links: TradeCommandSnapLinks,
): SnapResponse {
  const elements = buildElementMap([
    snapStack(
      "root",
      ["hdr", "body", "examples", "compose", "nav", "open_app"],
      { gap: "md" },
    ),
    snapText("hdr", "Trade", { weight: "bold", size: "md" }),
    snapText(
      "body",
      `Reply to ${COMMAND_BOT_HANDLE} with a trade command. The arena executes, the scoreboard updates.`,
      { size: "sm" },
    ),
    snapItemGroup("examples", ["ex_buy", "ex_sell"], { separator: true }),
    snapItem(
      "ex_buy",
      `${COMMAND_BOT_HANDLE} ${ctx.buyExample}`,
      "Example buy",
    ),
    snapItem(
      "ex_sell",
      `${COMMAND_BOT_HANDLE} ${ctx.sellExample}`,
      "Example sell",
    ),
    snapButton(
      "compose",
      "Preview Cast",
      { action: "compose_cast", params: { text: ctx.starterCommand } },
      { variant: "primary", icon: "share" },
    ),
    snapStack("nav", ["act_standings", "act_wallet"], {
      direction: "horizontal",
      gap: "sm",
    }),
    snapButton(
      "act_standings",
      "Standings",
      {
        action: links.standings.action,
        params: { target: links.standings.target },
      },
      { variant: "secondary", icon: "bar-chart" },
    ),
    snapButton(
      "act_wallet",
      "Wallet",
      { action: "open_mini_app", params: { target: links.walletMiniApp } },
      { variant: "secondary", icon: "wallet" },
    ),
    snapOpenMiniAppEntry(links.miniApp),
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
