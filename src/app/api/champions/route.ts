import { NextResponse } from "next/server";
import { getChampionStats } from "@/lib/aggregate";

export async function GET() {
  return NextResponse.json(await getChampionStats());
}
