import type { SnapResponse } from "./types";
import {
  buildElementMap,
  snapInlineActionEntries,
  snapItem,
  snapItemGroup,
  snapOpenMiniAppEntry,
  snapStack,
  snapText,
  type SnapActionLinks,
} from "./response";

export type StandingsSnapEntry = {
  rank: number | null;
  label: string;
  points: number;
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

export function buildStandingsSnapResponse(
  ctx: StandingsSnapContext,
  links: SnapActionLinks,
): SnapResponse {
  const itemIds = ctx.entries.map((_, index) => `i_${index}`);

  const elements = buildElementMap([
    snapStack("root", ["hdr", "standings", "actions", "open_app"], {
      gap: "md",
    }),
    snapText("hdr", `${ctx.displayHandle} - Standings`, {
      weight: "bold",
      size: "md",
    }),
    snapItemGroup("standings", itemIds, { separator: true }),
    ...ctx.entries.map((entry, index) =>
      snapItem(
        `i_${index}`,
        rowTitle(entry),
        `${entry.points.toLocaleString("en-US")} points`,
      ),
    ),
    ...snapInlineActionEntries(links),
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
