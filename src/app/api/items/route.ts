import { NextResponse } from "next/server";
import { getItemStats } from "@/lib/aggregate";
import { itemCategory } from "@/lib/gameData";

export async function GET() {
  return NextResponse.json(await getItemStats(itemCategory));
}
