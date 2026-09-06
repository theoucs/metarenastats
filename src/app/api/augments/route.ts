import { NextResponse } from "next/server";
import { getAugmentStats } from "@/lib/aggregate";

export async function GET() {
  return NextResponse.json(await getAugmentStats());
}
