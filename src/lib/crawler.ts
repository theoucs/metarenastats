import { supabaseAdmin } from "@/lib/supabase";
import { riotFetch } from "@/lib/riotClient";
import { ARENA_QUEUE_ID, apiKey, fetchMatchDetail, persistMatches } from "@/lib/riotSearch";

/**
 * Crawler Arena (phase 1 de docs/data-pipeline-plan.md).
 *
 * Le site ne se remplissait que quand quelqu'un faisait une recherche — un
 * problème d'amorçage classique : pas de données, donc pas de visiteurs, donc
 * pas de données. Le crawler casse la boucle en allant chercher les parties
 * lui-même.
 *
 * Le principe tient en une boucle, et l'Arena la rend particulièrement
 * efficace :
 *
 *   1. prendre des joueurs dans `crawl_queue`
 *   2. GET /matches/by-puuid/{puuid}/ids  → jusqu'à 100 identifiants
 *   3. écarter ceux déjà ingérés                    ← l'étape qui rend tout viable
 *   4. GET /matches/{id} pour les nouveaux          → 18 joueurs d'un coup
 *   5. écrire, puis remettre les 17 autres joueurs dans la file
 *
 * Chaque partie rapporte 17 nouveaux joueurs à explorer : on ne manque jamais
 * de graines. Et comme l'étape 3 compare *avant* d'appeler, la découverte ne
 * coûte presque rien — le budget d'appels ne part que sur des parties
 * réellement nouvelles.
 */

/** Le crawler accepte d'attendre un créneau de débit, contrairement à une page.
 *  Au-delà de la fenêtre de 120 s, rien ne sert d'attendre plus. */
const CRAWLER_MAX_WAIT_MS = 130_000;

/** Écriture par petits paquets : un échec ne fait perdre que son paquet. */
const PERSIST_BATCH = 10;

/** PostgREST plafonne toute réponse à 1000 lignes, et une URL trop longue est
 *  rejetée — d'où le découpage des filtres `in(...)`. */
const ID_CHUNK = 200;

export type CrawlOptions = {
  /** Marge sous le plafond d'exécution de la fonction (300 s côté Vercel). */
  maxDurationMs?: number;
  /** Plafond de matchs ingérés en une passe. */
  maxMatches?: number;
  /** Nombre de joueurs dont on lit l'historique par passe. */
  playerBatch?: number;
};

export type CrawlReport = {
  ok: boolean;
  /** Matchs réparés : connus mais restés incomplets (voir persistMatches). */
  repaired: number;
  /** Matchs nouvellement ingérés. */
  ingested: number;
  /** Joueurs dont l'historique a été lu. */
  playersCrawled: number;
  /** Joueurs découverts et ajoutés à la file. */
  playersDiscovered: number;
  /** Identifiants vus mais déjà en base — la mesure de la saturation du crawl. */
  alreadyKnown: number;
  /** Appels tentés. */
  riotCalls: number;
  /** Appels ayant réellement rapporté des données. Distinct de `riotCalls` :
   *  avec une clé expirée les deux divergent, et c'est le seul signal fiable
   *  pour dire qu'une passe n'a rien produit malgré son activité. */
  riotOk: number;
  durationMs: number;
  stoppedBy: "deadline" | "maxMatches" | "exhausted" | "apiUnavailable";
};

/**
 * Vérifie que la clé répond avant de dépenser le budget.
 *
 * Une clé de développement expire toutes les 24 h. Sans ce contrôle, une passe
 * lancée avec une clé morte brûlait **57 appels** en 401 avant de s'arrêter, et
 * recommençait à chaque cron — constaté sur une nuit entière.
 *
 * L'appel se fait sur `euw1`, dont le compteur de débit est distinct de celui
 * d'`europe` : il ne coûte donc rien au budget de crawl.
 */
async function isApiReachable(): Promise<boolean> {
  const res = await riotFetch(
    "https://euw1.api.riotgames.com/lol/status/v4/platform-data",
    apiKey(),
    { maxWaitMs: 5_000 },
  );
  if (res.status === 401 || res.status === 403) {
    console.error("[crawl] clé Riot refusée (HTTP " + res.status + ") — probablement expirée.");
    return false;
  }
  return res.ok;
}

function db() {
  if (!supabaseAdmin) throw new Error("Supabase n'est pas configuré (SUPABASE_SERVICE_ROLE_KEY manquante)");
  return supabaseAdmin;
}

/** Matchs connus mais jamais complétés — repris en priorité. */
async function pendingMatchIds(limit: number): Promise<string[]> {
  const { data, error } = await db()
    .from("matches")
    .select("match_id")
    .is("ingested_at", null)
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => r.match_id as string);
}

/** Prochains joueurs à explorer : priorité décroissante, jamais-crawlés d'abord. */
async function pickPlayers(limit: number): Promise<string[]> {
  const { data, error } = await db()
    .from("crawl_queue")
    .select("puuid")
    .lt("error_count", 5)
    .order("priority", { ascending: false })
    .order("last_crawled_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => r.puuid as string);
}

/** Historique Arena d'un joueur (100 = maximum autorisé par Riot en un appel). */
async function fetchPlayerMatchIds(puuid: string): Promise<string[] | null> {
  const res = await riotFetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids` +
      `?queue=${ARENA_QUEUE_ID}&start=0&count=100`,
    apiKey(),
    { maxWaitMs: CRAWLER_MAX_WAIT_MS },
  );
  if (!res.ok) {
    console.error(`[crawl] historique de ${puuid.slice(0, 12)}… indisponible : HTTP ${res.status}`);
    return null;
  }
  return res.json();
}

/**
 * Ne garde que les identifiants pas encore ingérés.
 *
 * C'est l'étape qui décide de l'efficacité du crawler : la comparaison coûte
 * une requête SQL pour 200 identifiants, là où l'appel Riot correspondant
 * coûterait 200 requêtes sur un budget de 100 toutes les deux minutes.
 */
async function keepNewMatchIds(ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids));
  const known = new Set<string>();
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const { data, error } = await db()
      .from("matches")
      .select("match_id")
      .in("match_id", unique.slice(i, i + ID_CHUNK))
      .not("ingested_at", "is", null);
    if (error) throw error;
    for (const r of data ?? []) known.add(r.match_id as string);
  }
  return unique.filter((id) => !known.has(id));
}

/** Ajoute les joueurs inconnus à la file, sans toucher à ceux déjà présents. */
async function enqueuePlayers(puuids: string[]): Promise<number> {
  const unique = Array.from(new Set(puuids));
  let added = 0;
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const chunk = unique.slice(i, i + ID_CHUNK);
    const { data, error } = await db()
      .from("crawl_queue")
      .upsert(
        chunk.map((puuid) => ({ puuid })),
        { onConflict: "puuid", ignoreDuplicates: true },
      )
      .select("puuid");
    if (error) throw error;
    added += data?.length ?? 0;
  }
  return added;
}

/** Note le passage sur un joueur pour qu'il repasse en fin de file. */
async function markPlayersCrawled(entries: { puuid: string; matchesFound: number }[]) {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  // `priority` et `discovered_at` ne sont pas dans la charge utile : PostgREST
  // ne met à jour que les colonnes fournies, elles sont donc préservées.
  const { error } = await db()
    .from("crawl_queue")
    .upsert(
      entries.map((e) => ({
        puuid: e.puuid,
        last_crawled_at: now,
        matches_found: e.matchesFound,
      })),
      { onConflict: "puuid" },
    );
  if (error) throw error;
}

/**
 * Une passe de crawl, bornée en temps et en nombre de matchs.
 *
 * Bornée parce qu'elle tourne dans une fonction serverless : mieux vaut
 * s'arrêter proprement et reprendre au passage suivant que se faire couper au
 * milieu d'une écriture. L'état vit entièrement en base (`crawl_queue` et
 * `matches.ingested_at`), donc une passe interrompue ne perd rien.
 */
export async function runCrawl({
  maxDurationMs = 240_000,
  maxMatches = 150,
  playerBatch = 15,
}: CrawlOptions = {}): Promise<CrawlReport> {
  const startedAt = Date.now();
  const deadline = startedAt + maxDurationMs;
  let riotCalls = 0;
  let riotOk = 0;
  let ingested = 0;
  let repaired = 0;
  let alreadyKnown = 0;
  let stoppedBy: CrawlReport["stoppedBy"] = "exhausted";

  // ── 0. La clé répond-elle ? ──────────────────────────────────────────────
  if (!(await isApiReachable())) {
    return {
      ok: false,
      repaired: 0,
      ingested: 0,
      playersCrawled: 0,
      playersDiscovered: 0,
      alreadyKnown: 0,
      riotCalls: 1,
      riotOk: 0,
      durationMs: Date.now() - startedAt,
      stoppedBy: "apiUnavailable",
    };
  }
  riotCalls++;
  riotOk++;

  // ── 1. Réparer avant de découvrir ────────────────────────────────────────
  // Un match connu mais incomplet ne coûte qu'un appel et comble un trou dans
  // les stats : c'est le meilleur rapport qualité/prix du budget.
  const pending = await pendingMatchIds(Math.min(maxMatches, 100));

  // ── 2. Découvrir de nouveaux matchs ──────────────────────────────────────
  const players = await pickPlayers(playerBatch);
  const crawled: { puuid: string; matchesFound: number }[] = [];
  const discoveredIds: string[] = [];

  for (const puuid of players) {
    if (Date.now() > deadline) {
      stoppedBy = "deadline";
      break;
    }
    const ids = await fetchPlayerMatchIds(puuid);
    riotCalls++;
    if (ids === null) continue;
    riotOk++;
    discoveredIds.push(...ids);
    crawled.push({ puuid, matchesFound: ids.length });
  }

  const newIds = await keepNewMatchIds(discoveredIds);
  alreadyKnown = new Set(discoveredIds).size - newIds.length;

  // Les réparations d'abord, puis les découvertes, sans doublon.
  const queue = Array.from(new Set([...pending, ...newIds]));
  const pendingSet = new Set(pending);

  // ── 3. Ingérer ───────────────────────────────────────────────────────────
  const seenPuuids: string[] = [];
  let batch: Awaited<ReturnType<typeof fetchMatchDetail>>[] = [];

  const flush = async () => {
    const usable = batch.filter((m) => m !== null);
    if (usable.length === 0) return;
    try {
      await persistMatches(usable);
      for (const m of usable) {
        if (pendingSet.has(m.matchId)) repaired++;
        else ingested++;
        seenPuuids.push(...m.participants.map((p) => p.puuid));
      }
    } catch (error) {
      // On ne relance pas : les matchs concernés restent à `ingested_at` NULL
      // et seront repris au passage suivant. Perdre un paquet est préférable à
      // perdre la passe entière.
      console.error("[crawl] écriture d'un paquet échouée, sera repris :", error);
    }
    batch = [];
  };

  for (const matchId of queue) {
    if (Date.now() > deadline) {
      stoppedBy = "deadline";
      break;
    }
    if (ingested + repaired >= maxMatches) {
      stoppedBy = "maxMatches";
      break;
    }
    const detail = await fetchMatchDetail(matchId, CRAWLER_MAX_WAIT_MS);
    riotCalls++;
    if (detail !== null) riotOk++;
    batch.push(detail);
    if (batch.length >= PERSIST_BATCH) await flush();
  }
  await flush();

  // ── 4. Alimenter la file ─────────────────────────────────────────────────
  const playersDiscovered = await enqueuePlayers(seenPuuids);
  await markPlayersCrawled(crawled);

  return {
    ok: true,
    repaired,
    ingested,
    playersCrawled: crawled.length,
    playersDiscovered,
    alreadyKnown,
    riotCalls,
    riotOk,
    durationMs: Date.now() - startedAt,
    stoppedBy,
  };
}
