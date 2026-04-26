import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/lib/arena/session";
import {
  getActiveSeason,
  getSeasonEntry,
  getSeasonTokens,
  serializeSeason,
  type SeasonEntry,
  type SeasonSummary,
  type SeasonToken,
} from "@/lib/seasons/service";

export const dynamic = "force-dynamic";

export type SeasonMeResponse = {
  season: SeasonSummary | null;
  entry: SeasonEntry | null;
  tokens: SeasonToken[];
};

export async function GET(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  try {
    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json<SeasonMeResponse>({
        season: null,
        entry: null,
        tokens: [],
      });
    }

    const [entry, tokens] = await Promise.all([
      getSeasonEntry({ seasonId: season.id, userId: session.userId }),
      getSeasonTokens(season.id),
    ]);

    const body: SeasonMeResponse = {
      season: serializeSeason(season),
      entry,
      tokens,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("season.me.failed", err);
    return NextResponse.json(
      { error: "season_me_failed" },
      { status: 500 },
    );
  }
}
