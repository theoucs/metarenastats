import { NextResponse } from "next/server";
import { getItemStats } from "@/lib/aggregate";

export async function GET() {
  return NextResponse.json(await getItemStats());
}
