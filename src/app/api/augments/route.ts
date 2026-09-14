import { NextResponse } from "next/server";
import { getAugmentStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { getPatchContext } from "@/lib/patches";

export async function GET() {
  return NextResponse.json(await readSnapshot("augments", getAugmentStats, (await getPatchContext()).defaultPatch));
}
