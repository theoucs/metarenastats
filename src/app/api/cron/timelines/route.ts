import { NextResponse } from "next/server";
import { runTimelineCrawl } from "@/lib/crawler";

/**
 * Une passe de récupération d'ordres d'achat (voir lib/timeline.ts).
 *
 * Séparée de /api/cron/crawl à dessein : un timeline pèse 1,48 Mo contre 138 Ko
 * pour un match et coûte un appel de plus. Les mêler diviserait par deux la
 * couverture en matchs, alors que la couverture prime — l'ordre d'achat, lui,
 * converge vite.
 */
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const num = (key: string) => {
    const raw = searchParams.get(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };

  try {
    const report = await runTimelineCrawl({
      maxDurationMs: num("maxDurationMs"),
      maxMatches: num("maxMatches"),
    });
    console.log(
      `[timeline] ${report.matchesDone} matchs, ${report.participantsUpdated} participants, ` +
        `${report.riotOk}/${report.riotCalls} appels aboutis, ${report.remaining} restants ` +
        `(arrêt : ${report.stoppedBy})`,
    );
    return NextResponse.json(report);
  } catch (error) {
    const message = errorMessage(error);
    console.error("[timeline] échec :", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
