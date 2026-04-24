import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapButton,
  snapItem,
  snapItemGroup,
  snapOpenMiniAppEntry,
  snapStack,
  snapText,
  type SnapActionLinks,
} from "./response";

export const COMMAND_BOT_HANDLE = "@commo";

export type TradeCommandSnapContext = {
  /** Pre-filled text passed to `compose_cast`. e.g. `@commo buy 1 usdc of AERO`. */
  starterCommand: string;
  /** Example buy command shown as a reference row (without the @commo prefix). */
  buyExample: string;
  /** Example sell command shown as a reference row (without the @commo prefix). */
  sellExample: string;
};

export type TradeCommandSnapLinks = Pick<
  SnapActionLinks,
  "walletMiniApp" | "miniApp"
> & {
  /**
   * Where the "Standings" button goes. When `kind: "snap"`, the button uses
   * `open_snap` to launch the inline standings snap for a specific FID. When
   * `kind: "mini_app"`, it falls back to `open_mini_app` on the standings tab
   * (used when no FID is available in context).
   */
  standings: { kind: "snap"; target: string } | { kind: "mini_app"; target: string };
};

/**
 * Simple compose-first trade command snap. Direct {@link https://docs.farcaster.xyz/snap/actions#compose_cast compose_cast}
 * action — no server round-trip, no signed form submission.
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
      links.standings.kind === "snap"
        ? { action: "open_snap", params: { target: links.standings.target } }
        : { action: "open_mini_app", params: { target: links.standings.target } },
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
