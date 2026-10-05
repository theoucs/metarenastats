/**
 * Les jobs du site, lancés directement par GitHub Actions.
 *
 *   npx tsx scripts/jobs.ts engine    crawl + timelines pendant MINUTES, compteurs à chaque cycle
 *   npx tsx scripts/jobs.ts publish   classement → matérialisation → snapshots, une fois
 *
 * ─── POURQUOI ICI ET PLUS DANS LES ROUTES DU SITE ───────────────────────────
 *
 * Jusqu'au 2026-10-02, les workflows ne faisaient qu'un `curl` vers
 * /api/cron/* : tout le calcul tournait en fonctions Vercel. Un moteur de
 * 5 h 30 y passait ~2 h 30, la publication ~6 min deux fois par heure —
 * de l'ordre de 15 h de fonctions à 2 Go par jour. Le compte Hobby a été
 * bloqué pour usage excessif le 2 octobre au soir (402 sur toutes les routes).
 *
 * Un runner GitHub est gratuit et sans limite de minutes pour un dépôt public,
 * a 7 Go de mémoire et jusqu'à 6 h par job : le même code y tourne tel quel,
 * sans le plafond de 300 s par appel. Vercel ne sert plus que les pages.
 *
 * Le rythme reste celui de engine.yml avant la migration (voir l'historique de
 * ce fichier) : deux passes de crawl et deux de timeline par cycle, mêmes
 * pauses, donc la même part de la clé Riot laissée aux recherches de joueurs.
 * Le limiteur de débit vit en mémoire de ce processus, comme il vivait dans
 * chaque instance Vercel : rien de changé de ce côté.
 */
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { runCrawl, runTimelineCrawl } from "@/lib/crawler";
import {
  refreshMaterialized,
  refreshRatings,
  refreshSiteCounters,
  refreshSnapshots,
} from "@/lib/statsSnapshot";

const env = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const MINUTES = env("MINUTES", 330);
const CRAWL_MATCHES = env("CRAWL_MATCHES", 120);
const TIMELINE_MATCHES = env("TIMELINE_MATCHES", 80);
const CRAWL_PASSES = env("CRAWL_PASSES", 2);
const TIMELINE_PASSES = env("TIMELINE_PASSES", 2);

/** Pauses après une passe et en fin de cycle : LE réglage de la part de la clé
 *  Riot qu'on s'autorise (voir l'en-tête de engine.yml). */
const PAUSE_AFTER_PASS_S = 30;
const PAUSE_AFTER_CYCLE_S = 135;
/** Ce qu'une passe s'accorde. Plus de plafond de 300 s à respecter, mais une
 *  passe courte rend la main aux timelines et aux compteurs plus souvent. */
const PASS_MAX_MS = 230_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

// ─── Le bail de publication ─────────────────────────────────────────────────
// Le même que la route /api/cron/refresh-stats : le moteur et le job horaire
// publient chacun, et deux phases classement simultanées s'effaceraient
// mutuellement leurs lignes (voir la migration 20260928-verrou-publication).
const PUBLISH_LOCK = "publish";
/** Plus long que sur Vercel : sans plafond de 300 s, une publication complète
 *  (~6 min) doit tenir dedans. Expire seul si le runner meurt. */
const PUBLISH_LOCK_TTL_S = 900;

async function withPublishLock<T>(run: () => Promise<T>): Promise<T | "busy"> {
  const db = supabaseAdmin!;
  const holder = randomUUID();
  const { data, error } = await db.rpc("try_job_lock", {
    p_name: PUBLISH_LOCK,
    p_holder: holder,
    p_ttl_seconds: PUBLISH_LOCK_TTL_S,
  });
  if (error) console.error(`::warning::Bail de publication illisible, on continue sans : ${error.message}`);
  else if (data !== true) return "busy";
  try {
    return await run();
  } finally {
    const { error: releaseError } = await db.rpc("release_job_lock", { p_name: PUBLISH_LOCK, p_holder: holder });
    if (releaseError) console.error(`[jobs] bail non rendu (il expirera seul) : ${releaseError.message}`);
  }
}

/**
 * Classement, matérialisation, snapshots — dans cet ordre (la matérialisation
 * fige le `skill_bucket` que le classement vient d'écrire). Une étape en échec
 * n'empêche pas les suivantes : des tier lists d'une heure valent mieux que
 * pas de tier lists. Renvoie false si la publication elle-même a échoué.
 */
async function publish(): Promise<boolean> {
  const result = await withPublishLock(async () => {
    try {
      const r = await refreshRatings();
      console.log(`· classement — ${r.rated} joueurs en ${r.durationMs} ms ${JSON.stringify(r.timings)}`);
    } catch (error) {
      console.log(`::warning::Classement échoué : ${message(error)}`);
    }
    try {
      const m = await refreshMaterialized();
      console.log(`· matérialisation en ${m.durationMs} ms`);
    } catch (error) {
      console.log(`::warning::Matérialisation échouée, publication sur la précédente : ${message(error)}`);
    }
    try {
      const s = await refreshSnapshots();
      console.log(
        `· publié — ${s.sourceMatches} matchs, ${s.snapshots} snapshots en ${s.durationMs} ms ${JSON.stringify(s.timings)}`,
      );
      if (s.truncated) console.log("::error::Snapshots calculés sur une lecture tronquée.");
      return !s.truncated;
    } catch (error) {
      const timings =
        typeof error === "object" && error !== null && "timings" in error
          ? JSON.stringify((error as { timings: unknown }).timings)
          : "";
      console.log(`::warning::Publication échouée : ${message(error)} ${timings}`);
      return false;
    }
  });
  if (result === "busy") {
    console.log("· publication déjà en cours ailleurs — sautée");
    return true;
  }
  return result;
}

async function publishCounters() {
  try {
    const { totalMatches } = await refreshSiteCounters();
    console.log(`· compteurs à jour — ${totalMatches} matchs`);
  } catch (error) {
    console.log(`::warning::Compteurs non rafraîchis : ${message(error)}`);
  }
}

async function engine(): Promise<number> {
  const deadline = Date.now() + MINUTES * 60_000;
  const nap = async (seconds: number) => {
    const left = deadline - Date.now();
    if (left > 0) await sleep(Math.min(seconds * 1000, left));
  };

  console.log(`::notice::Moteur lancé pour ${MINUTES} min.`);
  let cycle = 0;
  let ingested = 0;
  let repaired = 0;
  let timelines = 0;
  let remaining: number | string = "?";
  let failures = 0;

  while (Date.now() < deadline) {
    cycle++;
    console.log(`── cycle ${cycle} — reste ${Math.round((deadline - Date.now()) / 60_000)} min ──`);

    for (let i = 0; i < CRAWL_PASSES; i++) {
      try {
        const r = await runCrawl({ maxMatches: CRAWL_MATCHES, maxDurationMs: PASS_MAX_MS });
        console.log(`· crawl ${JSON.stringify(r)}`);
        // Clé de dev expirée (24 h) : chaque passe échouerait à l'identique.
        if (r.stoppedBy === "apiUnavailable") {
          console.log(
            "::warning::Clé Riot refusée — la régénérer, la mettre dans les secrets GitHub (RIOT_API_KEY) et sur Vercel. Moteur arrêté.",
          );
          return 0;
        }
        ingested += r.ingested;
        repaired += r.repaired;
      } catch (error) {
        // L'état vit en base : le cycle suivant reprend où on en est.
        console.log(`::warning::Passe de crawl échouée : ${message(error)}`);
        failures++;
      }
      await nap(PAUSE_AFTER_PASS_S);
    }

    for (let i = 0; i < TIMELINE_PASSES && Date.now() < deadline; i++) {
      try {
        const r = await runTimelineCrawl({ maxMatches: TIMELINE_MATCHES, maxDurationMs: PASS_MAX_MS });
        console.log(`· timeline ${JSON.stringify(r)}`);
        if (r.stoppedBy === "apiUnavailable") {
          console.log("::warning::Clé Riot refusée. Moteur arrêté.");
          return 0;
        }
        timelines += r.matchesDone;
        remaining = r.remaining;
      } catch (error) {
        console.log(`::warning::Passe de timeline échouée : ${message(error)}`);
        failures++;
      }
      await nap(PAUSE_AFTER_PASS_S);
    }

    // Les compteurs de l'accueil seulement : une fonction SQL, assez bon marché
    // pour chaque cycle. La publication complète, elle, n'est plus portée par le
    // moteur depuis le 2026-10-05 — refresh-stats.yml la fait chaque heure
    // (pg_cron le déclenche de façon fiable), et la faire deux fois par heure
    // doublait la charge sur la base pour rien.
    await publishCounters();
    await nap(PAUSE_AFTER_CYCLE_S);
  }

  console.log(
    `::notice::${cycle} cycles — ${ingested} matchs ingérés, ${repaired} réparés, ` +
      `${timelines} timelines (${remaining} restants), ${failures} passe(s) en échec.`,
  );
  // Rouge seulement si RIEN n'a été produit : un incident passager ne doit pas
  // faire passer pour un échec un job qui a travaillé des heures.
  if (ingested === 0 && timelines === 0) {
    console.log(`::error::Aucun match ni timeline sur ${cycle} cycles.`);
    return 1;
  }
  return 0;
}

async function main() {
  if (!supabaseAdmin) {
    console.log("::error::SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.");
    return 1;
  }
  const command = process.argv[2];
  if (command === "engine") return engine();
  if (command === "publish") return (await publish()) ? 0 : 1;
  console.log("Usage : tsx scripts/jobs.ts engine|publish");
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.log(`::error::${message(error)}`);
    process.exit(1);
  },
);
