import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapItem,
  snapItemGroup,
  snapMiniAppActionEntries,
  snapProgress,
  snapStack,
  snapText,
} from "./response";

import type { StatusViewContext } from "@/lib/status/load-context";
import type { MiniAppSnapLinks } from "@/lib/commodus/deep-links";

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
  links: MiniAppSnapLinks,
): SnapResponse {
  const maxProgress = Math.max(ctx.topTenCutoffPoints, ctx.points, 1);
  const rankTitle =
    ctx.rank != null ? `Rank #${ctx.rank}` : "Rank —";
  const rankDesc = "Monthly GLORY (points)";

  const progressLabel = `Monthly points vs top-10 cutoff (${ctx.topTenCutoffPoints.toLocaleString("en-US")})`;

  const elements = buildElementMap([
    snapStack("root", ["hdr", "prog", "stats", "actions"], {
      gap: "md",
    }),
    snapText("hdr", ctx.displayHandle, { weight: "bold", size: "md" }),
    snapProgress("prog", ctx.points, maxProgress, progressLabel),
    snapItemGroup(
      "stats",
      ["i_rank", "i_pts", "i_port", "i_slots"],
      { separator: true },
    ),
    snapItem("i_rank", rankTitle, rankDesc),
    snapItem(
      "i_pts",
      ctx.points.toLocaleString("en-US"),
      "Points this month",
    ),
    snapItem(
      "i_port",
      `${fmtUsd(ctx.portfolioUsdc)} USDC`,
      "Portfolio (cash + at-cost positions)",
    ),
    snapItem(
      "i_slots",
      ctx.dailySlotsRemaining.toLocaleString("en-US"),
      "Arena trades left today",
    ),
    ...snapMiniAppActionEntries(links),
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
