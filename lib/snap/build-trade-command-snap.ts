import type { SnapElement, SnapResponse } from "./types";
import {
  buildElementMap,
  snapButton,
  snapInput,
  snapItem,
  snapItemGroup,
  snapOpenMiniAppEntry,
  snapStack,
  snapText,
  snapToggleGroup,
  type SnapActionLinks,
} from "./response";

export const COMMAND_BOT_HANDLE = "@commo";

export type TradeCommandMode = "buy" | "sell";

export type TradeCommandSnapContext = {
  mode: TradeCommandMode;
  token: string;
  tokens: string[];
  buyAmount: string;
  sellPercent: string;
  maxTradeUsdc: number;
  command: string | null;
  error: string | null;
  submitUrl: string;
  editUrl: string;
};

function snapOptions(tokens: string[]): string[] {
  return tokens.slice(0, 6).map((token) => token.toUpperCase());
}

function selectedToken(ctx: TradeCommandSnapContext): string {
  const options = snapOptions(ctx.tokens);
  return options.includes(ctx.token.toUpperCase())
    ? ctx.token.toUpperCase()
    : options[0] ?? "AERO";
}

function formEntries(ctx: TradeCommandSnapContext): [string, SnapElement][] {
  const tokenOptions = snapOptions(ctx.tokens);
  const token = selectedToken(ctx);

  return [
    snapToggleGroup("mode", {
      name: "mode",
      label: "Side",
      options: ["Buy", "Sell"],
      defaultValue: ctx.mode === "buy" ? "Buy" : "Sell",
      variant: "outline",
    }),
    tokenOptions.length >= 2
      ? snapToggleGroup("token", {
          name: "token",
          label: "Token",
          options: tokenOptions,
          defaultValue: token,
          variant: "outline",
        })
      : snapInput("token", {
          name: "token",
          label: "Token",
          defaultValue: token,
          maxLength: 12,
        }),
    snapStack("amounts", ["buy_amount", "sell_percent"], { gap: "sm" }),
    snapInput("buy_amount", {
      name: "buyAmount",
      type: "number",
      label: `Buy amount, max ${ctx.maxTradeUsdc} USDC`,
      placeholder: "1",
      defaultValue: ctx.buyAmount,
      maxLength: 12,
    }),
    snapInput("sell_percent", {
      name: "sellPercent",
      type: "number",
      label: "Sell amount, 1-100%",
      placeholder: "50",
      defaultValue: ctx.sellPercent,
      maxLength: 3,
    }),
    snapText(
      "note",
      ctx.error ?? "Choose side, token, and amount before composing.",
      { size: "sm" },
    ),
    snapButton(
      "preview",
      "Preview Cast",
      { action: "submit", params: { target: ctx.submitUrl } },
      { variant: "primary", icon: "chevron-right" },
    ),
  ];
}

function previewEntries(ctx: TradeCommandSnapContext): [string, SnapElement][] {
  const castText = `${COMMAND_BOT_HANDLE} ${ctx.command}`;

  return [
    snapItemGroup("summary", ["i_side", "i_token", "i_amount"], {
      separator: true,
    }),
    snapItem("i_side", ctx.mode === "buy" ? "Buy" : "Sell", "Side"),
    snapItem("i_token", selectedToken(ctx), "Token"),
    snapItem(
      "i_amount",
      ctx.mode === "buy" ? `${ctx.buyAmount} USDC` : `${ctx.sellPercent}%`,
      "Amount",
    ),
    snapText("cast", castText, { size: "sm", weight: "bold" }),
    snapStack("actions", ["compose", "edit"], {
      direction: "horizontal",
      gap: "sm",
    }),
    snapButton(
      "compose",
      "Compose Cast",
      { action: "compose_cast", params: { text: castText } },
      { variant: "primary", icon: "share" },
    ),
    snapButton(
      "edit",
      "Edit",
      { action: "open_snap", params: { target: ctx.editUrl } },
      { variant: "secondary", icon: "arrow-left" },
    ),
  ];
}

export function buildTradeCommandSnapResponse(
  ctx: TradeCommandSnapContext,
  links: Pick<SnapActionLinks, "miniApp">,
): SnapResponse {
  const isPreview = ctx.command != null && ctx.error == null;

  const elements = buildElementMap([
    snapStack(
      "root",
      isPreview
        ? ["hdr", "summary", "cast", "actions", "open_app"]
        : ["hdr", "mode", "token", "amounts", "note", "preview", "open_app"],
      { gap: "md" },
    ),
    snapText("hdr", isPreview ? "Confirm Trade Cast" : "Trade", {
      weight: "bold",
      size: "md",
    }),
    ...(isPreview ? previewEntries(ctx) : formEntries(ctx)),
    snapOpenMiniAppEntry(links.miniApp),
  ]);

  return {
    version: "2.0",
    theme: { accent: ctx.mode === "sell" ? "green" : "purple" },
    ui: {
      root: "root",
      elements,
    },
  };
}
