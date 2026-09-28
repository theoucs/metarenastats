import { NextRequest, NextResponse } from "next/server";
import { clientIpFrom, searchPlayerMatches } from "@/lib/riotSearch";

export async function GET(req: NextRequest) {
  const riotId = req.nextUrl.searchParams.get("riotId")?.trim() ?? "";
  const result = await searchPlayerMatches(riotId, clientIpFrom(req.headers));

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ account: result.account, matches: result.matches });
}
