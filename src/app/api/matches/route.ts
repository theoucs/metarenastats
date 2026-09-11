import { NextRequest, NextResponse } from "next/server";
import { searchPlayerMatches } from "@/lib/riotSearch";

export async function GET(req: NextRequest) {
  const riotId = req.nextUrl.searchParams.get("riotId")?.trim() ?? "";
  const result = await searchPlayerMatches(riotId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ account: result.account, matches: result.matches });
}
