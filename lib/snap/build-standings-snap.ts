import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapItem,
  snapItemGroup,
  snapOpenMiniAppEntry,
  snapStack,
  snapStandingsNavEntries,
  snapText,
  type SnapActionLinks,
} from "./response";

export type StandingsSnapEntry = {
  rank: number | null;
  label: string;
  arenaValueUsdc: number;
  performanceReturn: number;
  isUser: boolean;
};

export type StandingsSnapContext = {
  displayHandle: string;
  entries: StandingsSnapEntry[];
};

function truncateLabel(raw: string, maxChars: number): string {
  const t = raw.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1)}...`;
}

function rankLabel(rank: number | null): string {
  return rank != null ? `#${rank}` : "Unranked";
}

function rowTitle(entry: StandingsSnapEntry): string {
  const label = truncateLabel(entry.label, entry.isUser ? 70 : 76);
  return `${rankLabel(entry.rank)} ${label}${entry.isUser ? " (you)" : ""}`;
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function fmtPercent(n: number): string {
  return n.toLocaleString("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  });
}

export function buildStandingsSnapResponse(
  ctx: StandingsSnapContext,
  links: SnapActionLinks,
): SnapResponse {
  const itemIds = ctx.entries.map((_, index) => `i_${index}`);

  const elements = buildElementMap([
    snapStack("root", ["hdr", "standings", "actions", "open_app"], {
      gap: "md",
    }),
    snapText("hdr", "Standings", {
      weight: "bold",
      size: "md",
    }),
    snapItemGroup("standings", itemIds, { separator: true }),
    ...ctx.entries.map((entry, index) =>
      snapItem(
        `i_${index}`,
        rowTitle(entry),
        `${fmtUsd(entry.arenaValueUsdc)} USDC · ${fmtPercent(entry.performanceReturn)}`,
      ),
    ),
    ...snapStandingsNavEntries(links),
    snapOpenMiniAppEntry(links.miniApp),
  ]);

  return {
    version: "2.0",
    theme: { accent: "amber" },
    ui: {
      root: "root",
      elements,
    },
  };
}
