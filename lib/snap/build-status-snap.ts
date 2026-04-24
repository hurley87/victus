import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapItem,
  snapItemGroup,
  snapInlineActionEntries,
  snapOpenMiniAppEntry,
  snapStack,
  snapText,
  type SnapActionLinks,
} from "./response";

import type { StatusViewContext } from "@/lib/status/load-context";

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Builds a Snap 2.0 JSON payload for the monthly status card.
 * Tree stays within Snap structural limits (≤64 nodes, depth ≤4, ≤6 children per stack).
 */
export function buildStatusSnapResponse(
  ctx: StatusViewContext,
  links: SnapActionLinks,
): SnapResponse {
  const rankTitle =
    ctx.rank != null ? `#${ctx.rank}` : "Unranked";

  const elements = buildElementMap([
    snapStack("root", ["hdr", "stats", "actions", "open_app"], {
      gap: "md",
    }),
    snapText("hdr", "Wallet", { weight: "bold", size: "md" }),
    snapItemGroup(
      "stats",
      ["i_rank", "i_pts", "i_port", "i_slots"],
      { separator: true },
    ),
    snapItem("i_rank", rankTitle, "Rank"),
    snapItem(
      "i_pts",
      ctx.points.toLocaleString("en-US"),
      "Points",
    ),
    snapItem(
      "i_port",
      `${fmtUsd(ctx.portfolioUsdc)} USDC`,
      "Value",
    ),
    snapItem(
      "i_slots",
      ctx.dailySlotsRemaining.toLocaleString("en-US"),
      "Trades left today",
    ),
    ...snapInlineActionEntries(links),
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
