import { NextResponse, type NextRequest } from "next/server";

import { miniAppTabDeepLink } from "@/lib/commodus/deep-links";
import { getPublicArenaRules } from "@/lib/arena/service";
import {
  buildTradeCommandSnapResponse,
  type TradeCommandMode,
  type TradeCommandSnapContext,
} from "@/lib/snap/build-trade-command-snap";
import {
  escapeHtml,
  requestAcceptsSnap,
  SNAP_MEDIA,
  snapVaryHeader,
} from "@/lib/snap/http";
import { SnapJfsError, verifySnapActionRequest } from "@/lib/snap/jfs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function snapResourceUrl(request: NextRequest): string {
  return `${request.nextUrl.origin}/api/snaps/trade-command`;
}

function htmlFallbackForNonSnapAccept(request: NextRequest): NextResponse {
  const selfUrl = snapResourceUrl(request);
  const tradeUrl = miniAppTabDeepLink("trade");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Victus trade command</title>
</head>
<body>
  <p>Victus trade command Snap</p>
  <p><a href="${escapeHtml(tradeUrl)}">Open Mini App</a></p>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      Link: `<${selfUrl}>; rel="alternate"; type="${SNAP_MEDIA}"`,
      Vary: snapVaryHeader(request),
    },
  });
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalizeMode(value: unknown): TradeCommandMode {
  return asString(value).toLowerCase() === "sell" ? "sell" : "buy";
}

function formatTradeNumber(value: number, maxFractionDigits: number): string {
  return value.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

function defaultBuyAmount(maxTradeUsdc: number): string {
  return formatTradeNumber(Math.min(1, Math.max(maxTradeUsdc, 0)), 2);
}

function selectedToken(input: unknown, tokens: string[]): string {
  const token = asString(input).toUpperCase();
  return tokens.includes(token) ? token : tokens[0] ?? "AERO";
}

function contextFromInputs(params: {
  request: NextRequest;
  inputs?: Record<string, unknown>;
  validate: boolean;
}): Promise<TradeCommandSnapContext> {
  return getPublicArenaRules().then((rules) => {
    const tokens = rules.whitelist
      .filter((entry) => entry.is_tradable)
      .map((entry) => entry.symbol.toUpperCase())
      .slice(0, 6);
    const mode = normalizeMode(params.inputs?.mode);
    const explicitToken = asString(params.inputs?.token).toUpperCase();
    const token =
      explicitToken && tokens.includes(explicitToken)
        ? explicitToken
        : selectedToken(params.inputs?.token, tokens);
    let buyAmount =
      asString(params.inputs?.buyAmount) || defaultBuyAmount(rules.max_trade_usdc);
    let sellPercent = asString(params.inputs?.sellPercent) || "50";
    const submitUrl = snapResourceUrl(params.request);

    let error: string | null = null;
    let command: string | null = null;

    if (params.validate) {
      if (explicitToken && !tokens.includes(explicitToken)) {
        error = "Pick a live arena token.";
      } else if (!tokens.includes(token)) {
        error = "Pick a live arena token.";
      } else if (mode === "buy") {
        const amount = Number(buyAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
          error = "Buy amount must be above 0 USDC.";
        } else if (amount > rules.max_trade_usdc) {
          error = `Max buy is ${rules.max_trade_usdc} USDC.`;
        } else {
          buyAmount = formatTradeNumber(amount, 2);
          command = `buy ${buyAmount} usdc of ${token.toLowerCase()}`;
        }
      } else {
        const percent = Number(sellPercent);
        if (
          !Number.isInteger(percent) ||
          percent <= 0 ||
          percent > 100
        ) {
          error = "Sell amount must be a whole percent from 1 to 100.";
        } else {
          sellPercent = String(percent);
          command = `sell ${sellPercent}% of ${token.toLowerCase()}`;
        }
      }
    }

    return {
      mode,
      token,
      tokens,
      buyAmount,
      sellPercent,
      maxTradeUsdc: rules.max_trade_usdc,
      command,
      error,
      submitUrl,
      editUrl: submitUrl,
    };
  });
}

function snapResponse(
  request: NextRequest,
  ctx: TradeCommandSnapContext,
): NextResponse {
  const selfSnapUrl = snapResourceUrl(request);
  const snap = buildTradeCommandSnapResponse(ctx, {
    miniApp: miniAppTabDeepLink("trade"),
  });

  return NextResponse.json(snap, {
    status: 200,
    headers: {
      "Content-Type": SNAP_MEDIA,
      "Cache-Control": "no-store",
      Link: `<${selfSnapUrl}>; rel="alternate"; type="${SNAP_MEDIA}"`,
      Vary: snapVaryHeader(request),
    },
  });
}

export async function GET(request: NextRequest) {
  if (!requestAcceptsSnap(request.headers.get("accept"))) {
    return htmlFallbackForNonSnapAccept(request);
  }

  try {
    const ctx = await contextFromInputs({ request, validate: false });
    return snapResponse(request, ctx);
  } catch (err) {
    console.error("snaps/trade-command GET failed", err);
    return NextResponse.json({ error: "Failed to load snap" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { payload } = await verifySnapActionRequest(request);
    const ctx = await contextFromInputs({
      request,
      inputs: payload.inputs,
      validate: true,
    });
    return snapResponse(request, ctx);
  } catch (err) {
    if (err instanceof SnapJfsError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("snaps/trade-command POST failed", err);
    return NextResponse.json({ error: "Failed to build command" }, { status: 500 });
  }
}
