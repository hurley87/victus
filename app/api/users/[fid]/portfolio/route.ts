import { NextResponse, type NextRequest } from "next/server";

import { getPortfolioByFid } from "@/lib/portfolio/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ fid: string }> },
) {
  const { fid: fidRaw } = await context.params;
  const fid = Number(fidRaw);
  if (!Number.isFinite(fid) || fid <= 0) {
    return NextResponse.json({ error: "Invalid fid" }, { status: 400 });
  }

  try {
    const portfolio = await getPortfolioByFid(fid);
    if (!portfolio) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json(portfolio);
  } catch (err) {
    console.error("portfolio failed", err);
    return NextResponse.json(
      { error: "Failed to load portfolio" },
      { status: 500 },
    );
  }
}
