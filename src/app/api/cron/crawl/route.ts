import { NextResponse } from "next/server";
import { runCrawl } from "@/lib/crawler";

/**
 * Une passe de crawl (voir lib/crawler.ts).
 *
 * Même schéma que /api/cron/refresh-stats : déclenché par GitHub Actions,
 * protégé par le même `CRON_SECRET`, et le calcul reste dans l'app Next pour
 * que la logique d'ingestion n'existe qu'en un seul exemplaire — celle de la
 * recherche joueur et celle du crawler partagent `fetchMatchDetail` et
 * `persistMatches`.
 *
 * Quand la clé de production arrivera, cette passe devra migrer vers un vrai
 * worker autonome : le plafond de 300 s d'une fonction serverless deviendra le
 * facteur limitant, alors qu'aujourd'hui c'est le débit de la clé de dev
 * (100 appels / 2 min) qui borne tout — un passage ne peut de toute façon pas
 * dépasser ~200 appels.
 */
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function errorMessage(error: unknown): string {
  // Les erreurs Supabase ne sont pas des `Error` mais des objets
  // { message, details, hint, code } — un String() dessus masquerait la cause.
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
    const report = await runCrawl({
      maxDurationMs: num("maxDurationMs"),
      maxMatches: num("maxMatches"),
      playerBatch: num("playerBatch"),
    });
    console.log(
      `[crawl] +${report.ingested} matchs, ${report.repaired} réparés, ` +
        `${report.playersCrawled} joueurs lus, ${report.playersDiscovered} découverts, ` +
        `${report.riotOk}/${report.riotCalls} appels Riot aboutis en ${report.durationMs} ms ` +
        `(arrêt : ${report.stoppedBy})`,
    );
    return NextResponse.json(report);
  } catch (error) {
    const message = errorMessage(error);
    console.error("[crawl] échec :", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
