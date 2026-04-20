/**
 * Farcaster Snap 2.0 response shapes (json-render tree).
 * @see https://docs.farcaster.xyz/snap/spec-overview
 */

export type SnapVersion = "2.0";

export type SnapPaletteAccent =
  | "purple"
  | "green"
  | "red"
  | "blue"
  | "amber"
  | "accent";

export type SnapTheme = {
  accent?: SnapPaletteAccent | string;
};

export type SnapUiSpec = {
  root: string;
  elements: Record<string, SnapElement>;
  state?: Record<string, unknown>;
};

export type SnapElement = {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
  on?: {
    press?: {
      action: string;
      params?: Record<string, unknown>;
    };
  };
};

export type SnapResponse = {
  version: SnapVersion;
  theme?: SnapTheme;
  ui: SnapUiSpec;
};
