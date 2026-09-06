import { NextResponse } from "next/server";
import { getLeaderboardStats } from "@/lib/aggregate";

export async function GET() {
  return NextResponse.json(await getLeaderboardStats());
}
