import { NextResponse } from "next/server";
import { getChampionStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { getPatchContext } from "@/lib/patches";

export async function GET() {
  return NextResponse.json(await readSnapshot("champions", getChampionStats, (await getPatchContext()).defaultPatch));
}
