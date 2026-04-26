import { ImageResponse } from "next/og";

import { appBaseUrl } from "@/lib/commodus/deep-links";
import { loadGoogleFont, loadImage } from "@/lib/og-utils";
import { getTradeShareCard } from "@/lib/sharing/trade-card";

export const dynamic = "force-dynamic";

const SIZE = { width: 600, height: 400 };

const GOLD = "#c8a84e";
const GOLD_MUTED = "#8a7434";
const BG_DARK = "#0a0a0a";
const BG_PANEL = "#141414";
const TEXT_DIM = "#9ca3af";
const PNL_POSITIVE = "#5ee07a";
const PNL_NEGATIVE = "#ef6a6a";

function formatUsd(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  return `${sign}$${abs.toFixed(abs >= 100 ? 0 : 2)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ executionId: string }> },
) {
  try {
    const { executionId } = await params;
    const card = await getTradeShareCard(executionId);
    if (!card) {
      return new Response("trade not found", { status: 404 });
    }

    const base = appBaseUrl();
    const logoBuf = await loadImage(`${base}/images/icon.png`);
    const logoSrc = `data:image/png;base64,${Buffer.from(logoBuf).toString("base64")}`;

    const playerLabel = card.username ? `@${card.username}` : `fid ${card.fid}`;
    const actionLabel = card.action === "buy" ? "BUY" : "SELL";
    const symbolLabel = card.symbol ? `$${card.symbol.toUpperCase()}` : "";
    const headerLine = `${playerLabel} · ${actionLabel} ${symbolLabel}`;
    const pointsLine = card.points > 0 ? `+${card.points} pts` : `${card.points} pts`;
    const pnl = card.realized_pnl_usdc;
    const showPnl = card.action === "sell" && pnl != null;

    const fontText = `VICTUS ${headerLine} ${pointsLine} POINTS NOTIONAL PNL ${
      card.notional_usdc != null ? formatUsd(card.notional_usdc) : ""
    } ${showPnl && pnl != null ? formatUsd(pnl) : ""}`;
    const fontData = await loadGoogleFont("Press+Start+2P", fontText);

    const pnlPositive = pnl != null && pnl >= 0;

    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            backgroundColor: BG_DARK,
            backgroundImage: `linear-gradient(135deg, rgba(200,168,78,0.18), rgba(20,20,20,0.96) 44%, rgba(0,0,0,0.98))`,
            padding: "32px 36px",
            fontFamily: "PressStart2P",
            color: "white",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img
              src={logoSrc}
              width={48}
              height={48}
              alt=""
              style={{ borderRadius: 8 }}
            />
            <div style={{ fontSize: 16, color: GOLD, letterSpacing: 2 }}>
              VICTUS
            </div>
          </div>

          <div
            style={{
              marginTop: 28,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ fontSize: 12, color: GOLD_MUTED, letterSpacing: 1 }}>
              ARENA TRADE
            </div>
            <div style={{ fontSize: 22, color: "white" }}>{headerLine}</div>
          </div>

          <div
            style={{
              marginTop: 28,
              display: "flex",
              alignItems: "center",
              gap: 24,
              padding: "18px 22px",
              borderRadius: 14,
              border: `1px solid ${GOLD_MUTED}`,
              backgroundColor: BG_PANEL,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                flex: 1,
              }}
            >
              <div style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: 1 }}>
                POINTS
              </div>
              <div style={{ fontSize: 44, color: GOLD }}>{pointsLine}</div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "flex-end",
              }}
            >
              {showPnl && pnl != null ? (
                <>
                  <div
                    style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: 1 }}
                  >
                    REALIZED PNL
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      color: pnlPositive ? PNL_POSITIVE : PNL_NEGATIVE,
                    }}
                  >
                    {formatUsd(pnl)}
                  </div>
                </>
              ) : (
                <>
                  <div
                    style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: 1 }}
                  >
                    NOTIONAL
                  </div>
                  <div style={{ fontSize: 22, color: "white" }}>
                    {card.notional_usdc != null
                      ? formatUsd(card.notional_usdc)
                      : "—"}
                  </div>
                </>
              )}
            </div>
          </div>

          <div
            style={{
              marginTop: "auto",
              fontSize: 12,
              color: GOLD,
              letterSpacing: 1,
            }}
          >
            Trade live in the Victus arena
          </div>
        </div>
      ),
      {
        ...SIZE,
        fonts: [{ name: "PressStart2P", data: fontData, style: "normal" }],
      },
    );
  } catch (err) {
    console.error("trade og card failed", err);
    return new Response("failed to generate trade card", { status: 500 });
  }
}
