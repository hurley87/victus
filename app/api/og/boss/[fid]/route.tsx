import { ImageResponse } from "next/og";

import { env } from "@/lib/env";
import { getCurrentMonthLeaderboard } from "@/lib/leaderboard/service";
import { loadGoogleFont, loadImage } from "@/lib/og-utils";

export const dynamic = "force-dynamic";

const SIZE = { width: 600, height: 400 };

const GOLD = "#c8a84e";
const GOLD_MUTED = "#8a7434";
const BG_DARK = "#0a0a0a";
const BG_PANEL = "#141414";
const TEXT_DIM = "#9ca3af";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fid: string }> },
) {
  try {
    const { fid: fidRaw } = await params;
    const fid = Number(fidRaw);
    if (!Number.isFinite(fid) || fid <= 0 || !Number.isInteger(fid)) {
      return new Response("invalid fid", { status: 400 });
    }

    const { entries } = await getCurrentMonthLeaderboard();
    const player = entries.find((e) => e.fid === fid && !e.is_commodus);
    const commodus = entries.find((e) => e.is_commodus);
    if (!player || !commodus) {
      return new Response("not eligible", { status: 404 });
    }
    if (player.points <= commodus.points) {
      return new Response("not ahead of commodus", { status: 404 });
    }

    const appUrl = env.NEXT_PUBLIC_URL.replace(/\/$/, "");
    const logoBuf = await loadImage(`${appUrl}/images/icon.png`);
    const logoSrc = `data:image/png;base64,${Buffer.from(logoBuf).toString("base64")}`;

    const playerLabel = player.username ? `@${player.username}` : `fid ${player.fid}`;
    const headline = `${playerLabel} has beaten Commodus`;
    const lead = player.points - commodus.points;
    const leadLine = `${lead} pt${lead === 1 ? "" : "s"} ahead of the emperor`;

    const fontText = `VICTUS ${headline} ${leadLine} POINTS RANK ${player.points} ${player.rank}`;
    const fontData = await loadGoogleFont("Press+Start+2P", fontText);

    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            backgroundColor: BG_DARK,
            backgroundImage: `linear-gradient(135deg, rgba(200,168,78,0.28), rgba(20,20,20,0.96) 44%, rgba(0,0,0,0.98))`,
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
              EMPEROR DEFEATED
            </div>
            <div style={{ fontSize: 22, color: "white" }}>{headline}</div>
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
              <div style={{ fontSize: 44, color: GOLD }}>{player.points}</div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "flex-end",
              }}
            >
              <div style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: 1 }}>
                RANK
              </div>
              <div style={{ fontSize: 22, color: "white" }}>
                #{player.rank}
              </div>
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
            {leadLine}
          </div>
        </div>
      ),
      {
        ...SIZE,
        fonts: [{ name: "PressStart2P", data: fontData, style: "normal" }],
      },
    );
  } catch (err) {
    console.error("boss og card failed", err);
    return new Response("failed to generate boss card", { status: 500 });
  }
}
