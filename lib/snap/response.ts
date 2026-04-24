import type { SnapElement, SnapPaletteAccent, SnapUiSpec } from "./types";

/** @see https://docs.farcaster.xyz/snap/elements#text */
export function snapText(
  id: string,
  content: string,
  props?: { size?: "sm" | "md"; weight?: "normal" | "bold"; align?: string },
): [string, SnapElement] {
  return [
    id,
    {
      type: "text",
      props: { content, ...props },
    },
  ];
}

/** @see https://docs.farcaster.xyz/snap/elements#stack */
export function snapStack(
  id: string,
  children: string[],
  props?: {
    direction?: "vertical" | "horizontal";
    gap?: "none" | "sm" | "md" | "lg";
    justify?: string;
  },
): [string, SnapElement] {
  return [
    id,
    {
      type: "stack",
      props: props ?? {},
      children,
    },
  ];
}

/** @see https://docs.farcaster.xyz/snap/elements#progress */
export function snapProgress(
  id: string,
  value: number,
  max: number,
  label?: string,
): [string, SnapElement] {
  return [
    id,
    {
      type: "progress",
      props: { value, max, ...(label ? { label } : {}) },
    },
  ];
}

/** @see https://docs.farcaster.xyz/snap/elements#item */
export function snapItem(
  id: string,
  title: string,
  description?: string,
): [string, SnapElement] {
  return [
    id,
    {
      type: "item",
      props: { title, ...(description ? { description } : {}) },
    },
  ];
}

/** @see https://docs.farcaster.xyz/snap/elements#item_group */
export function snapItemGroup(
  id: string,
  itemIds: string[],
  props?: { border?: boolean; separator?: boolean },
): [string, SnapElement] {
  return [
    id,
    {
      type: "item_group",
      props: props ?? {},
      children: itemIds,
    },
  ];
}

/** @see https://docs.farcaster.xyz/snap/elements#bar_chart */
export function snapBarChart(
  id: string,
  bars: { label: string; value: number; color?: SnapPaletteAccent }[],
  max?: number,
  defaultColor?: SnapPaletteAccent,
): [string, SnapElement] {
  return [
    id,
    {
      type: "bar_chart",
      props: {
        bars,
        ...(max != null ? { max } : {}),
        ...(defaultColor ? { color: defaultColor } : {}),
      },
    },
  ];
}

/** @see https://docs.farcaster.xyz/snap/elements#button */
export function snapButton(
  id: string,
  label: string,
  onPress: { action: string; params?: Record<string, unknown> },
  props?: { variant?: "primary" | "secondary"; icon?: string },
): [string, SnapElement] {
  return [
    id,
    {
      type: "button",
      props: { label, ...props },
      on: { press: onPress },
    },
  ];
}

export function buildElementMap(entries: [string, SnapElement][]): SnapUiSpec["elements"] {
  return Object.fromEntries(entries);
}

/** Standard three-button mini-app action row shared by all snap builders. */
export function snapMiniAppActionEntries(links: {
  wallet: string;
  trade: string;
  standings: string;
}): [string, SnapElement][] {
  return [
    snapStack("actions", ["act_wallet", "act_trade", "act_standings"], {
      direction: "horizontal",
      gap: "sm",
    }),
    snapButton(
      "act_wallet",
      "View Wallet",
      { action: "open_mini_app", params: { target: links.wallet } },
      { variant: "primary", icon: "wallet" },
    ),
    snapButton(
      "act_trade",
      "Trade",
      { action: "open_mini_app", params: { target: links.trade } },
      { variant: "secondary", icon: "repeat" },
    ),
    snapButton(
      "act_standings",
      "Standings",
      { action: "open_mini_app", params: { target: links.standings } },
      { variant: "secondary", icon: "bar-chart" },
    ),
  ];
}
