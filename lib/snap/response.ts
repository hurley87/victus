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

/** @see https://docs.farcaster.xyz/snap/elements#input */
export function snapInput(
  id: string,
  props: {
    name: string;
    type?: "text" | "number";
    label?: string;
    placeholder?: string;
    defaultValue?: string;
    maxLength?: number;
  },
): [string, SnapElement] {
  return [
    id,
    {
      type: "input",
      props,
    },
  ];
}

/** @see https://docs.farcaster.xyz/snap/elements#toggle_group */
export function snapToggleGroup(
  id: string,
  props: {
    name: string;
    options: string[];
    multiple?: boolean;
    orientation?: "horizontal" | "vertical";
    defaultValue?: string | string[];
    variant?: "default" | "outline";
    label?: string;
  },
): [string, SnapElement] {
  return [
    id,
    {
      type: "toggle_group",
      props,
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

export type SnapActionLinks = {
  tradeSnap: string;
  standingsSnap: string;
  miniApp: string;
};

/** Inline snap navigation. The mini-app escape hatch is rendered separately as the final root child. */
export function snapInlineActionEntries(links: {
  tradeSnap: string;
  standingsSnap: string;
}): [string, SnapElement][] {
  return [
    snapStack("actions", ["act_trade", "act_standings"], {
      direction: "horizontal",
      gap: "sm",
    }),
    snapButton(
      "act_trade",
      "Trade",
      { action: "open_snap", params: { target: links.tradeSnap } },
      { variant: "secondary", icon: "repeat" },
    ),
    snapButton(
      "act_standings",
      "Standings",
      { action: "open_snap", params: { target: links.standingsSnap } },
      { variant: "secondary", icon: "bar-chart" },
    ),
  ];
}

/** Bottom escape hatch required on every Victus snap page. */
export function snapOpenMiniAppEntry(
  target: string,
  label = "Open Mini App",
): [string, SnapElement] {
  return snapButton(
    "open_app",
    label,
    { action: "open_mini_app", params: { target } },
    { variant: "primary", icon: "arrow-right" },
  );
}
