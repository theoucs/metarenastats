import { NextResponse } from "next/server";
import { getItemStats } from "@/lib/aggregate";
import { itemCategory } from "@/lib/gameData";
import { readSnapshot } from "@/lib/statsSnapshot";

export async function GET() {
  return NextResponse.json(await readSnapshot("items", () => getItemStats(itemCategory)));
}
