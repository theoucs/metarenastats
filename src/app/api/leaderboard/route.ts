import { NextResponse } from "next/server";
import { getLeaderboardStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";

export async function GET() {
  return NextResponse.json(await readSnapshot("leaderboard", getLeaderboardStats));
}
