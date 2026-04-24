import type { MiniAppSnapLinks } from "@/lib/commodus/deep-links";
import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapItem,
  snapItemGroup,
  snapMiniAppActionEntries,
  snapStack,
  snapText,
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

function fmtNumber(n: number | null, maxFractionDigits = 6): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

function fmtUsd(n: number | null, options?: { sign?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...(options?.sign ? { signDisplay: "exceptZero" as const } : {}),
  });
}

function shortHash(hash: string | null): string {
  if (!hash) return "Proof pending";
  return hash.length > 13 ? `${hash.slice(0, 10)}...` : hash;
}

/**
 * Builds a trade-specific Snap for final trade outcome replies.
 * Tree stays within Snap structural limits (<=64 nodes, depth <=4, <=6 root children).
 */
export function buildTradeSnapResponse(
  ctx: TradeSnapContext,
  links: MiniAppSnapLinks,
): SnapResponse {
  const { trade } = ctx;
  const verb = trade.action === "buy" ? "Bought" : "Sold";
  const status =
    trade.status === "confirmed" ? "Victory" : trade.status.replace(/_/g, " ");
  const rankTitle = ctx.rank != null ? `Rank #${ctx.rank}` : "Rank n/a";
  const tradeItems = [
    "i_trade",
    "i_qty",
    "i_notional",
    ...(trade.action === "sell" ? ["i_pnl"] : []),
    "i_proof",
  ];

  const elements = buildElementMap([
    snapStack("root", ["hdr", "trade", "context", "actions"], {
      gap: "md",
    }),
    snapText("hdr", `${ctx.displayHandle} - ${status}`, {
      weight: "bold",
      size: "md",
    }),
    snapItemGroup("trade", tradeItems, { separator: true }),
    snapItem("i_trade", `${verb} ${trade.symbol}`, "Completed arena trade"),
    snapItem(
      "i_qty",
      `${fmtNumber(trade.quantity)} ${trade.symbol}`,
      "Token quantity",
    ),
    snapItem(
      "i_notional",
      `${fmtUsd(trade.notionalUsdc)} USDC`,
      trade.action === "buy" ? "USDC spent" : "USDC received gross",
    ),
    ...(trade.action === "sell"
      ? [
          snapItem(
            "i_pnl",
            `${fmtUsd(trade.realizedPnlUsdc, { sign: true })} USDC`,
            "Realized PnL",
          ),
        ]
      : []),
    snapItem("i_proof", shortHash(trade.txHash), "Base transaction proof"),
    snapItemGroup(
      "context",
      ["i_rank", "i_pts", "i_port", "i_slots"],
      { separator: true },
    ),
    snapItem("i_rank", rankTitle, "Monthly standings"),
    snapItem(
      "i_pts",
      ctx.points.toLocaleString("en-US"),
      "Monthly points",
    ),
    snapItem(
      "i_port",
      `${fmtUsd(ctx.portfolioUsdc)} USDC`,
      "Portfolio value",
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
    theme: { accent: trade.action === "sell" ? "green" : "purple" },
    ui: {
      root: "root",
      elements,
    },
  };
}
