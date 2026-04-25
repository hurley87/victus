import { COMMAND_BOT_HANDLE } from "@/lib/commodus/bot";

import {
  buildElementMap,
  snapButton,
  snapInput,
  snapOpenMiniAppEntry,
  snapStack,
  snapText,
  snapToggleGroup,
} from "./response";
import type { JsonRenderExpression, SnapElement, SnapResponse } from "./types";

/** Snap `toggle_group` supports 2–6 options; keep the whitelist bounded accordingly. */
export const TRADE_COMMAND_SYMBOL_LIMIT = 6;

export type TradeCommandSnapContext = {
  /** Whitelist symbols in the order they should appear (UPPER or mixed case is fine). */
  symbols: string[];
  /** Default selected symbol. Must be a member of `symbols`. */
  defaultSymbol: string;
  /** Default amount (also used as placeholder) for the amount input. */
  amountDefault: string;
};

export type StandingsPress =
  | { action: "open_snap"; target: string }
  | { action: "open_mini_app"; target: string };

export type TradeCommandSnapLinks = {
  /** Legacy POST target retained for callers still wiring the fallback route. */
  composeSubmit?: string;
  /** Always prefers `open_snap`; falls back to `open_mini_app` only if no FID context is available. */
  standings: StandingsPress;
  /** Wallet/portfolio snap. Falls back to `open_mini_app` only when FID is missing. */
  wallet: StandingsPress;
  /** Mini-app deep link used exclusively by the footer "Open Mini App" button. */
  miniApp: string;
};

const TRADE_STATE_PATHS = {
  action: "/action",
  symbol: "/symbol",
  amount: "/amount",
} as const;

/**
 * Trade composer snap. Users pick buy/sell, a token, and an amount; the
 * primary CTA opens the composer directly using json-render state templates.
 */
export function buildTradeCommandSnapResponse(
  ctx: TradeCommandSnapContext,
  links: TradeCommandSnapLinks,
): SnapResponse {
  const symbols = ctx.symbols.slice(0, TRADE_COMMAND_SYMBOL_LIMIT);
  if (symbols.length < 2) {
    throw new Error(
      "buildTradeCommandSnapResponse: at least 2 tradable symbols required for toggle_group",
    );
  }
  const defaultSymbol = symbols.includes(ctx.defaultSymbol)
    ? ctx.defaultSymbol
    : symbols[0]!;

  const elements = buildElementMap([
    snapStack(
      "root",
      [
        "hdr",
        "action",
        "symbol",
        "amount",
        "compose",
        "nav",
        "open_app",
      ],
      { gap: "md" },
    ),
    snapText("hdr", "Trade", { weight: "bold", size: "md" }),
    snapToggleGroup("action", {
      name: "action",
      label: "Side",
      options: ["Buy", "Sell"],
      value: bindTradeState("action"),
      defaultValue: "Buy",
    }),
    snapToggleGroup("symbol", {
      name: "symbol",
      label: "Token",
      options: symbols,
      value: bindTradeState("symbol"),
      defaultValue: defaultSymbol,
    }),
    snapInput("amount", {
      name: "amount",
      type: "number",
      label: "Amount (USDC to buy, % to sell)",
      placeholder: ctx.amountDefault,
      value: bindTradeState("amount"),
      defaultValue: ctx.amountDefault,
    }),
    snapStack("compose", ["compose_buy", "compose_sell"], { gap: "none" }),
    tradeComposeButton("compose_buy", "Buy"),
    tradeComposeButton("compose_sell", "Sell"),
    snapStack("nav", ["act_standings", "act_wallet"], {
      direction: "horizontal",
      gap: "sm",
    }),
    snapButton(
      "act_standings",
      "Standings",
      {
        action: links.standings.action,
        params: { target: links.standings.target },
      },
      { variant: "secondary", icon: "bar-chart" },
    ),
    snapButton(
      "act_wallet",
      "Wallet",
      {
        action: links.wallet.action,
        params: { target: links.wallet.target },
      },
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
      state: {
        action: "Buy",
        symbol: defaultSymbol,
        amount: ctx.amountDefault,
      },
    },
  };
}

function bindTradeState(
  key: keyof typeof TRADE_STATE_PATHS,
): JsonRenderExpression {
  return { $bindState: TRADE_STATE_PATHS[key] };
}

function selectedTradeSide(side: "Buy" | "Sell"): JsonRenderExpression {
  return { $state: TRADE_STATE_PATHS.action, eq: side };
}

function tradeCommandTemplate(side: "Buy" | "Sell"): JsonRenderExpression {
  const body =
    side === "Buy"
      ? `buy \${${TRADE_STATE_PATHS.amount}} usdc of \${${TRADE_STATE_PATHS.symbol}}`
      : `sell \${${TRADE_STATE_PATHS.amount}}% of \${${TRADE_STATE_PATHS.symbol}}`;

  return { $template: `${COMMAND_BOT_HANDLE} ${body}` };
}

function tradeComposeButton(
  id: string,
  side: "Buy" | "Sell",
): [string, SnapElement] {
  return withVisibility(
    snapButton(
      id,
      "Make Trade",
      {
        action: "compose_cast",
        params: { text: tradeCommandTemplate(side) },
      },
      { variant: "primary", icon: "share" },
    ),
    selectedTradeSide(side),
  );
}

function withVisibility(
  [id, element]: [string, SnapElement],
  visible: JsonRenderExpression,
): [string, SnapElement] {
  return [id, { ...element, visible }];
}

/* ------------------------------------------------------------------ */
/* Confirmation snap (POST response from /api/snaps/trade-command)    */
/* ------------------------------------------------------------------ */

export type TradeCommandConfirmContext = {
  /** Fully-composed cast text, e.g. `"@commo buy 5 usdc of aero"`. */
  castText: string;
  /** Optional error message displayed in lieu of the confirmation body. */
  error?: string | null;
};

export type TradeCommandConfirmLinks = {
  /** Mini-app deep link used exclusively by the footer "Open Mini App" button. */
  miniApp: string;
  /** Snap URL to navigate back to the form (so users can edit). */
  editSnap: string;
};

/**
 * Minimal confirmation snap returned from the POST handler. Presents the
 * interpolated cast text and a single primary `compose_cast` button, or an
 * error body with an Edit button back to the form.
 */
export function buildTradeCommandConfirmSnapResponse(
  ctx: TradeCommandConfirmContext,
  links: TradeCommandConfirmLinks,
): SnapResponse {
  const hasError = Boolean(ctx.error);

  const previewAndCompose: [string, SnapElement][] = hasError
    ? []
    : [
        snapText("preview", ctx.castText, { weight: "bold", size: "md" }),
        snapButton(
          "compose",
          "Post Cast",
          { action: "compose_cast", params: { text: ctx.castText } },
          { variant: "primary", icon: "share" },
        ),
      ];

  const rootChildren = hasError
    ? ["hdr", "body", "nav", "open_app"]
    : ["hdr", "body", "preview", "compose", "nav", "open_app"];

  const elements = buildElementMap([
    snapStack("root", rootChildren, { gap: "md" }),
    snapText("hdr", "Trade", { weight: "bold", size: "md" }),
    snapText("body", ctx.error ?? "Ready to cast:", { size: "sm" }),
    ...previewAndCompose,
    snapStack("nav", ["act_back"], { direction: "horizontal", gap: "sm" }),
    snapButton(
      "act_back",
      "Edit",
      { action: "open_snap", params: { target: links.editSnap } },
      { variant: "secondary", icon: "refresh-cw" },
    ),
    snapOpenMiniAppEntry(links.miniApp),
  ]);

  return {
    version: "2.0",
    theme: { accent: hasError ? "red" : "purple" },
    ui: { root: "root", elements },
  };
}
