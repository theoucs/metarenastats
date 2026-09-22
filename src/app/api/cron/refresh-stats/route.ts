import { NextResponse } from "next/server";
import { refreshRatings, refreshSiteCounters, refreshSnapshots } from "@/lib/statsSnapshot";

/**
 * Recalcule tous les snapshots de stats (voir lib/statsSnapshot.ts).
 *
 * Déclenché par GitHub Actions (.github/workflows/refresh-stats.yml) plutôt que
 * par un cron Vercel : le plan Hobby limite les crons à **une fois par jour**,
 * ce qui est trop peu, et GitHub Actions est gratuit et illimité en minutes sur
 * un repo public. C'est aussi là que tournera le crawler en phase 1, autant
 * n'avoir qu'un seul endroit qui déclenche les jobs.
 *
 * Le calcul reste ici, dans l'app Next, plutôt que dupliqué dans un script :
 * la logique d'agrégation vit dans lib/aggregate.ts et ne doit exister qu'une
 * fois. Le workflow ne fait qu'un curl.
 */

// Le job dépasse largement le temps d'un rendu de page : il lit toute la table
// et enchaîne une dizaine d'agrégations.
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Sans secret configuré, l'endpoint reste fermé : il écrit en base et ne doit
  // jamais être ouvert par défaut à cause d'une variable d'environnement oubliée.
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const only = new URL(request.url).searchParams.get("only");

  // `?only=counters` ne rafraîchit que les compteurs de l'accueil : une seule
  // fonction SQL, donc assez bon marché pour tourner à chaque cycle du moteur.
  if (only === "counters") {
    const { totalMatches } = await refreshSiteCounters();
    console.log(`[cron] compteurs rafraîchis — ${totalMatches} matchs`);
    return NextResponse.json({ ok: true, only: "counters", totalMatches });
  }

  // `?only=ratings` et `?only=snapshots` découpent le recalcul en deux
  // invocations (voir refreshRatings) : la somme des deux phases ne tient plus
  // dans les 300 s d'une seule fonction. Appelés l'un après l'autre, dans cet
  // ordre — la publication fige le `skill_bucket` que le classement vient
  // d'écrire.
  //
  // Sans paramètre, la route fait toujours les deux à la suite : c'est ce qui
  // permet de relancer un recalcul complet à la main, et ce que fait le filet
  // horaire quand il a le temps.
  if (only === "ratings") {
    try {
      const report = await refreshRatings();
      console.log(
        `[cron] classement recalculé en ${report.durationMs} ms — ${report.rated} joueurs, ` +
          `${report.promoted} promu(s)`,
      );
      return NextResponse.json(report);
    } catch (error) {
      return NextResponse.json(failure(error), { status: 500 });
    }
  }

  try {
    if (only !== "snapshots") await refreshRatings();
    const report = await refreshSnapshots();
    console.log(
      `[cron] ${report.snapshots} snapshots écrits en ${report.durationMs} ms ` +
        `(${report.sourceMatches} matchs, ${report.sourceParticipants} participants, ` +
        `${(report.bytes / 1024).toFixed(0)} Ko de JSON)`,
    );
    // `truncated` remonte jusqu'ici volontairement : c'est le signal que la base
    // a dépassé ce que l'agrégation en mémoire sait traiter, et que les stats
    // publiées sont partielles.
    if (report.truncated) {
      console.error("[cron] ATTENTION : snapshots calculés sur une lecture tronquée.");
    }
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(failure(error), { status: 500 });
  }
}

/**
 * Le corps d'une réponse d'échec.
 *
 * Les erreurs Supabase ne sont pas des `Error` : ce sont des objets
 * { message, details, hint, code }. Un String() dessus donne « [object Object] »
 * et masque complètement la cause.
 */
function failure(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
  console.error("[cron] échec du rafraîchissement :", message);
  // Les mesures de phase accompagnent l'erreur (voir refreshSnapshots) : sans
  // elles, la seule exécution qui mérite d'être analysée est la seule dont on
  // ne saurait rien.
  const timings =
    typeof error === "object" && error !== null && "timings" in error
      ? (error as { timings: Record<string, number> }).timings
      : undefined;
  return {
    ok: false,
    error: message,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
    timings,
  };
}

export async function POST(request: Request) {
  return handle(request);
}

// GET accepté aussi pour pouvoir déclencher un rafraîchissement à la main
// (curl) sans changer de méthode — la protection par secret est la même.
export async function GET(request: Request) {
  return handle(request);
}
