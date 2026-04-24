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

export type TradeSnapContext = {
  displayHandle: string;
  rank: number | null;
  points: number;
  portfolioUsdc: number;
  dailySlotsRemaining: number;
  trade: {
    action: "buy" | "sell";
    symbol: string;
    status: string;
    quantity: number | null;
    notionalUsdc: number | null;
    realizedPnlUsdc: number | null;
    txHash: string | null;
  };
};

function fmtUsd(n: number | null, options?: { sign?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...(options?.sign ? { signDisplay: "exceptZero" as const } : {}),
  });
}

/**
 * Builds a trade-specific Snap for final trade outcome replies.
 * Tree stays within Snap structural limits (<=64 nodes, depth <=4, <=6 root children).
 */
export function buildTradeSnapResponse(
  ctx: TradeSnapContext,
  links: SnapActionLinks,
): SnapResponse {
  const { trade } = ctx;
  const status =
    trade.status === "confirmed" ? "Victory" : trade.status.replace(/_/g, " ");
  const rankTitle = ctx.rank != null ? `#${ctx.rank}` : "Unranked";

  const elements = buildElementMap([
    snapStack("root", ["hdr", "stats", "actions", "open_app"], {
      gap: "md",
    }),
    snapText("hdr", `${ctx.displayHandle} - ${status}`, {
      weight: "bold",
      size: "md",
    }),
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
    theme: { accent: trade.action === "sell" ? "green" : "purple" },
    ui: {
      root: "root",
      elements,
    },
  };
}
