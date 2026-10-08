import { getHeapStatistics } from "node:v8";
import { supabaseAdmin } from "@/lib/supabase";
import { championRole, itemCategory, resolveAugment } from "@/lib/gameData";
import { getPatchContext, patchedKey } from "@/lib/patches";
import {
  markLadderTop,
  promoteTrackedPlayers,
  refreshLadderChampions,
  refreshPlayerRatings,
} from "@/lib/playerRatings";
import {
  readParticipantSetForPatch,
  refreshPublishedParticipants,
  withParticipantSet,
  getAnvilChampionStats,
  getAugmentStats,
  getAugmentTimingStats,
  getChampionDetail,
  getChampionMovers,
  getChampionStats,
  getComboStats,
  getCompStats,
  getItemStats,
  getLeaderboardStats,
  getSiteStats,
} from "@/lib/aggregate";

/**
 * Stats pré-calculées.
 *
 * Le problème résolu : chaque page appelait un agrégateur qui chargeait toute
 * la table `match_participants` en mémoire pour agréger en JavaScript. À 900
 * matchs c'était déjà 3,7 Mo d'egress Supabase et ~2,4 s de calcul *par vue de
 * page* ; à 100 000 matchs ce serait ~500 Mo par vue. Autrement dit un mur, pas
 * une pente.
 *
 * La correction : la logique d'agrégation ne change pas d'un iota — elle
 * s'exécute simplement ailleurs et à un autre moment. Un job périodique
 * (`/api/cron/refresh-stats`) l'exécute une fois et écrit chaque résultat ici ;
 * les pages ne lisent plus qu'une ligne de quelques Ko.
 *
 * Ce découplage est aussi le point de couture pour la suite : le jour où le
 * crawler rendra le JS insuffisant, on remplacera le *calcul* par du SQL sans
 * toucher à une seule page (phase 3 de docs/data-pipeline-plan.md).
 */

export const SNAPSHOT_KEYS = {
  site: "site",
  champions: "champions",
  anvil: "anvil",
  items: "items",
  augments: "augments",
  augmentTiming: "augment-timing",
  leaderboard: "leaderboard",
  comps: "comps",
  combos: "combos",
  movers: "movers",
} as const;

/** Une page de champion par champion vu en jeu — clé `champion:ahri`. */
export function championDetailKey(championIdLower: string): string {
  return `champion:${championIdLower}`;
}

const augmentRarity = (id: number) =>
  resolveAugment(id)?.tier as "silver" | "gold" | "prismatic" | undefined;

export type SnapshotPayloads = {
  site: Awaited<ReturnType<typeof getSiteStats>>;
  champions: Awaited<ReturnType<typeof getChampionStats>>;
  anvil: Awaited<ReturnType<typeof getAnvilChampionStats>>;
  items: Awaited<ReturnType<typeof getItemStats>>;
  augments: Awaited<ReturnType<typeof getAugmentStats>>;
  augmentTiming: Awaited<ReturnType<typeof getAugmentTimingStats>>;
  leaderboard: Awaited<ReturnType<typeof getLeaderboardStats>>;
  comps: Awaited<ReturnType<typeof getCompStats>>;
  combos: Awaited<ReturnType<typeof getComboStats>>;
  movers: Awaited<ReturnType<typeof getChampionMovers>>;
};

type SnapshotRow = { key: string; payload: unknown };

/**
 * Lit un snapshot, en retombant sur un calcul direct s'il n'existe pas encore.
 *
 * Le repli compte : sur une base fraîche, ou tant que le cron n'a jamais tourné,
 * le site doit afficher de vraies stats plutôt qu'une page vide. Ce repli coûte
 * exactement ce que coûtait l'ancien comportement — donc jamais pire qu'avant,
 * et seulement jusqu'au premier passage du job.
 */
export async function readSnapshot<K extends keyof SnapshotPayloads>(
  key: K,
  compute: () => Promise<SnapshotPayloads[K]>,
  patch?: string | null,
): Promise<SnapshotPayloads[K]> {
  const storageKey = patch ? patchedKey(SNAPSHOT_KEYS[key], patch) : SNAPSHOT_KEYS[key];
  const stored = await readSnapshotRaw(storageKey);
  if (stored !== null) return stored as SnapshotPayloads[K];
  console.warn(`[stats] snapshot "${storageKey}" absent — calcul direct (le cron a-t-il tourné ?)`);
  // Le repli doit calculer sur le MÊME périmètre que le snapshot manquant,
  // sinon une page afficherait tout l'historique là où elle annonce un patch.
  if (!patch) return compute();
  return withParticipantSet(await readParticipantSetForPatch(patch), compute);
}

/**
 * Les mouvements d'un patch, SANS repli de calcul.
 *
 * Un snapshot absent (le job n'est pas encore passé depuis le déploiement) veut
 * dire « rien à signaler », pas « recalculer » : le repli de readSnapshot
 * relirait les ~500 000 participations du patch pour un bloc qui, la plupart du
 * temps, est vide.
 */
export async function readMoversSnapshot(
  patch: string | null,
): Promise<SnapshotPayloads["movers"]> {
  const empty = { patch, previousPatch: null, movers: [] };
  if (!patch) return empty;
  const stored = await readSnapshotRaw(patchedKey(SNAPSHOT_KEYS.movers, patch));
  return (stored as SnapshotPayloads["movers"] | null) ?? empty;
}

/** Zéro partie : le bloc « Opening augment » ne s'affiche alors pas du tout,
 *  ce qui est la bonne réponse tant que le job n'a pas republié. */
const EMPTY_OUTCOME = { games: 0, top3Rate: 0, top1Rate: 0, avgPlacement: 0 };

/**
 * Un snapshot écrit par une version précédente du job.
 *
 * Les listes longues des onglets (voir ChampionDetail) sont arrivées après coup.
 * Entre le déploiement et le premier passage du job — une demi-heure au pire —
 * les snapshots en base sont ceux d'avant et n'ont pas ces champs. Les combler
 * ici plutôt que de les rendre optionnels partout : le type dit ce que le job
 * produit aujourd'hui, et seule cette frontière connaît le décalage.
 */
function withMissingLists(
  detail: NonNullable<Awaited<ReturnType<typeof getChampionDetail>>>,
): NonNullable<Awaited<ReturnType<typeof getChampionDetail>>> {
  return {
    ...detail,
    allAugments: detail.allAugments ?? [],
    allItems: detail.allItems ?? [],
    allCombos: detail.allCombos ?? { "item-item": [], "item-augment": [], "augment-augment": [] },
    anvilItems: detail.anvilItems ?? [],
    anvilAugments: detail.anvilAugments ?? [],
    anvilOpening: detail.anvilOpening ?? { statAnvil: EMPTY_OUTCOME, other: EMPTY_OUTCOME },
  };
}

/** Même repli, pour les pages de détail d'un champion (clé dynamique). */
export async function readChampionDetailSnapshot(
  championIdLower: string,
  patch?: string | null,
): Promise<Awaited<ReturnType<typeof getChampionDetail>>> {
  const base = championDetailKey(championIdLower);
  const storageKey = patch ? patchedKey(base, patch) : base;
  const stored = await readSnapshotRaw(storageKey);
  if (stored !== null) {
    return withMissingLists(stored as NonNullable<Awaited<ReturnType<typeof getChampionDetail>>>);
  }
  console.warn(`[stats] snapshot champion "${storageKey}" absent — calcul direct`);
  const compute = () => getChampionDetail(championIdLower, augmentRarity, itemCategory);
  if (!patch) return compute();
  return withParticipantSet(await readParticipantSetForPatch(patch), compute);
}

async function readSnapshotRaw(key: string): Promise<unknown | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("stats_snapshots")
    .select("payload")
    .eq("key", key)
    .maybeSingle();
  // Une table absente ou une erreur de lecture ne doit pas casser la page : on
  // laisse l'appelant retomber sur le calcul direct.
  if (error) {
    console.error(`[stats] lecture du snapshot "${key}" impossible :`, error.message);
    return null;
  }
  return data?.payload ?? null;
}

export type RefreshReport = {
  ok: boolean;
  snapshots: number;
  sourceMatches: number;
  sourceParticipants: number;
  truncated: boolean;
  durationMs: number;
  bytes: number;
  /** Ce qui a été publié, patch par patch. */
  patches: { patch: string; matches: number; participants: number }[];
  /** Le classement, quand il a été recalculé dans la MÊME invocation. Nul
   *  quand la publication tourne seule (`?only=snapshots`), ce qui est le cas
   *  normal depuis le découpage du 2026-09-22 : la phase classement a son
   *  propre appel et son propre budget de 300 s. */
  rated: number | null;
  /** Le commit qui a produit ce rapport.
   *
   *  Trois fois dans la même journée j'ai mesuré ou validé du travail sans
   *  savoir si le code déployé était le bon, et deux de ces fois la conclusion
   *  était fausse. Vercel expose la révision ; la faire remonter coûte une
   *  ligne et supprime la question. */
  commit: string;
  /**
   * Tas JS occupé aux moments qui comptent, en mégaoctets.
   *
   * Le plafond de lecture (MAX_PAGES × PAGE_SIZE) est un garde-fou MÉMOIRE :
   * le job tient les participations des deux patchs publiés en même temps. Il
   * était jusqu'ici réglé sur une estimation — « 600 000 lignes ≈ 120 Mo » —
   * jamais vérifiée. On ne peut pas décider de le relever sans savoir ce que
   * coûte vraiment une ligne, et une estimation fausse d'un facteur deux fait
   * la différence entre de la marge et un plantage sans message.
   */
  memoryMb: { apresLecture: number; fin: number; plafond: number; lignes: number };
  /** Millisecondes par phase. Permanent et non temporaire : ce job vit sous une
   *  limite dure de 300 s, et savoir CE QUI coûte est la seule façon de décider
   *  quoi alléger quand il s'en approche. */
  timings: Record<string, number>;
};

/**
 * Recalcule et réécrit tous les snapshots. Appelé par le cron, jamais par une
 * page.
 *
 * Deux périmètres cohabitent, et c'est délibéré :
 *
 *  - **par patch** : tier lists, combos, compos, pages de champion. Les chiffres
 *    d'un patch périmé ne veulent plus rien dire — un augment nerfé de 20 %
 *    garde ses anciens résultats — donc chaque patch a son propre jeu.
 *  - **tout l'historique** : classement et compteurs du site. Le palmarès d'un
 *    joueur ne se remet pas à zéro à chaque patch, et « 2 087 matchs suivis »
 *    parle de ce que le site connaît, pas du patch courant.
 *
 * Chaque patch fait UNE lecture, propagée à tous ses agrégateurs par
 * `withParticipantSet`. Ne pas remplacer ça par le `cache()` de React : il ne
 * s'applique pas dans un route handler, et sans le contexte explicite un
 * rafraîchissement relit la base 184 fois par patch (mesuré).
 */
/**
 * Rafraîchit UNIQUEMENT les compteurs de l'accueil.
 *
 * Le recalcul complet est cher (il relit tous les participants, patch par
 * patch) : on ne peut pas le lancer toutes les dix minutes sans y laisser le
 * quota d'egress. Mais les trois compteurs de l'accueil, eux, sortent d'une
 * seule fonction SQL qui rend trois entiers — c'est gratuit.
 *
 * Or c'est le chiffre le plus visible du site, et celui qui dit s'il est
 * vivant. Le laisser vieillir d'une heure pendant que la base grossit donne
 * l'impression que le crawler est en panne, ce qui est arrivé deux fois dans
 * la même soirée.
 *
 * Ne touche pas aux autres snapshots et ne fait AUCUN ménage : une passe
 * partielle qui élaguerait ce qu'elle n'a pas écrit effacerait tout le site.
 */
export async function refreshSiteCounters(): Promise<{ totalMatches: number }> {
  const db = supabaseAdmin;
  if (!db) throw new Error("Supabase n'est pas configuré (SUPABASE_SERVICE_ROLE_KEY manquante)");

  const site = await getSiteStats();
  const { error } = await db.from("stats_snapshots").upsert(
    {
      key: SNAPSHOT_KEYS.site,
      payload: site,
      computed_at: new Date().toISOString(),
      source_matches: site.totalMatches,
      source_participants: 0,
      truncated: false,
    },
    { onConflict: "key" },
  );
  if (error) throw error;
  return { totalMatches: site.totalMatches };
}

/** Snapshots par requête d'écriture, et requêtes simultanées. Quatre flux
 *  suffisent à recouvrir sérialisation et transfert sans inonder la base. */
const SNAPSHOT_CHUNK = 24;
const SNAPSHOT_WRITERS = 4;

/**
 * ─── LES PAIRES NE SE RECALCULENT PAS TOUTES LES HEURES ─────────────────────
 *
 * Former les paires est le poste le plus lourd du job, et il est payé DEUX
 * fois : une fois par `getComboStats` sur tout l'échantillon, une fois par
 * `getChampionDetail` sur chaque champion — ce qui, sommé sur les 173, refait
 * exactement le même travail. Chaque participation produit ~31 paires, soit
 * ~14 millions par patch. Profilé le 2026-09-16, les combos pesaient 28 % de
 * l'agrégation du site « sans compter leur part dans les pages de champion ».
 *
 * Mesuré le 2026-09-25, la même agrégation descendue en SQL coûte 36,8 s sur
 * le patch 16.18 — et extrapolée à un patch complet au rythme de crawl actuel
 * (~3,6 M de participations), ~320 s pour un budget de 300. Autrement dit le
 * problème n'est pas le langage : c'est la CADENCE.
 *
 * Une paire d'objets ne change pas de valeur en soixante minutes. Sur un patch
 * qui compte des centaines de milliers de participations, une heure de plus
 * déplace un taux de quelques centièmes de point — et le tableau est de toute
 * façon coupé à 200 lignes par catégorie, seuil que ces centièmes ne font pas
 * franchir.
 *
 * Les paires sont donc reprises telles quelles tant qu'elles ont moins de
 * 24 h. Tout le reste du site continue d'être recalculé chaque heure.
 */
const COMBOS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Le tas occupé, arrondi au mégaoctet. */
const heapMb = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

/**
 * Le plafond du tas que V8 s'autorise, en mégaoctets.
 *
 * C'est la seule valeur qui rende la mesure d'occupation exploitable : savoir
 * qu'on occupe 214 Mo ne dit rien tant qu'on ignore si le toit est à 500 Mo ou
 * à 2 Go. Vercel le dérive de la mémoire configurée pour la fonction, qu'on ne
 * lit nulle part dans le dépôt — autant le demander au moteur.
 */
const heapLimitMb = () =>
  Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024);

/** Ce qu'une page de champion garde d'une passe à l'autre quand les paires
 *  sont encore fraîches. Dérivé de la signature plutôt que réécrit : les deux
 *  ne peuvent pas diverger. */
type ReusedCombos = NonNullable<Parameters<typeof getChampionDetail>[3]>;

/**
 * L'âge des paires publiées pour ce patch, et les paires par champion si elles
 * sont encore bonnes.
 *
 * Une seule décision pour les deux endroits qui forment des paires : soit on
 * les refait partout, soit on les reprend partout. Les laisser diverger
 * donnerait une tier list des combos d'une heure et des pages de champion
 * d'une autre, sur les mêmes données.
 *
 * Les champs de paires sont projetés côté serveur (`payload->allCombos`) :
 * relire les 173 pages entières pour n'en garder que deux champs ferait
 * traverser plusieurs mégaoctets sans raison.
 */
async function reusableCombos(patch: string): Promise<{
  fresh: boolean;
  ageHours: number;
  global: unknown | null;
  byChampion: Map<string, ReusedCombos>;
}> {
  const db = supabaseAdmin;
  const empty = { fresh: false, ageHours: 0, global: null, byChampion: new Map<string, ReusedCombos>() };
  if (!db) return empty;

  const globalKey = patchedKey(SNAPSHOT_KEYS.combos, patch);
  const { data: head, error: headError } = await db
    .from("stats_snapshots")
    .select("payload, computed_at")
    .eq("key", globalKey)
    .maybeSingle();
  // Une lecture ratée ne doit pas empêcher de publier : on recalcule, c'est
  // plus lent mais juste.
  if (headError || !head?.computed_at) return empty;

  const age = Date.now() - new Date(head.computed_at as string).getTime();
  if (age > COMBOS_MAX_AGE_MS) return empty;

  const prefix = `${championDetailKey("")}`;
  const { data: rows, error } = await db
    .from("stats_snapshots")
    .select("key, allCombos:payload->allCombos, championCombos:payload->championCombos")
    .like("key", `${prefix}%@${patch}`);
  if (error) return empty;

  const byChampion = new Map<string, ReusedCombos>();
  for (const r of rows ?? []) {
    // Un champion dont la page précédente n'a pas ces champs — version plus
    // ancienne du job, ou page neuve — doit être recalculé, pas rempli de vide.
    if (!r.allCombos || !r.championCombos) continue;
    byChampion.set(r.key as string, {
      allCombos: r.allCombos as ReusedCombos["allCombos"],
      championCombos: r.championCombos as ReusedCombos["championCombos"],
    });
  }
  return { fresh: true, ageHours: Math.round(age / 3_600_000), global: head.payload, byChampion };
}

export type RatingsReport = {
  ok: boolean;
  rated: number;
  matches: number;
  promoted: number;
  archived: number;
  durationMs: number;
  commit: string;
  timings: Record<string, number>;
};

/** Matchs par appel d'archive_old_matches. Mesuré le 2026-09-28 : 5 000
 *  matchs (~90 000 participations) en ~25 s. */
const ARCHIVE_BATCH = 5000;

/** Au-delà, on laisse la suite au passage suivant : la phase doit finir dans
 *  ses 300 s, et le classement en a déjà pris ~100. */
const ARCHIVE_BUDGET_MS = 150_000;

/**
 * Résume puis supprime les participations des matchs sortis des deux patchs
 * publiés (voir supabase/migrations/20260928-archivage-automatique.sql).
 *
 * Ici, dans la phase classement, et APRÈS le MMR : un match n'est archivable
 * qu'une fois sa ligne de classement construite depuis ses participations —
 * c'est sync_match_rating_rows, appelé par refreshPlayerRatings, qui la
 * construit. La fonction SQL le vérifie elle-même.
 *
 * Le jour d'une bascule de patch, ~30 000 matchs d'un coup : quelques passages
 * horaires, par tranches. Les autres heures, les quelques retardataires du
 * crawler, en une seconde.
 */
async function archiveOldMatches(phaseStartedAt: number): Promise<number> {
  let total = 0;
  while (Date.now() - phaseStartedAt < ARCHIVE_BUDGET_MS) {
    const { data, error } = await supabaseAdmin!.rpc("archive_old_matches", {
      max_matches: ARCHIVE_BATCH,
    });
    if (error) throw error;
    const archived = Number(data ?? 0);
    total += archived;
    if (archived < ARCHIVE_BATCH) break;
  }
  return total;
}

/**
 * La phase classement, détachée de la publication.
 *
 * ─── POURQUOI DEUX APPELS ET NON UN ─────────────────────────────────────────
 *
 * Le job faisait deux métiers dans une seule invocation de 300 s : recalculer
 * le classement, puis publier les tier lists. Relevé du 2026-09-22, une fois le
 * disque desserré — donc sur un job qui n'échouait plus pour une autre raison :
 *
 *   mmr          96 s
 *   promote     167 s   puis dépassement du délai
 *   (jamais atteints) matérialisation ~92 s, agrégations ~150 s
 *
 * 264 s consommées avant la moitié du travail. Même avec `promote` réparé, la
 * somme dépasse le budget.
 *
 * Or les deux métiers ne se parlent qu'en UN point : cette phase réécrit
 * `player_ratings`, et la table matérialisée de la publication fige le
 * `skill_bucket` qui en dérive. La publication doit donc passer APRÈS — mais
 * rien n'exige la même invocation, puisque l'état vit en base entre les deux.
 *
 * Les séparer double le budget sans toucher au calcul. Ce n'est pas la solution
 * de fond — l'agrégation en JS lit 600 000 lignes par patch à travers PostgREST
 * et ce plafond est à 380 000 sur le patch 16.17 — mais ça achète les mois
 * qu'il faut pour la faire proprement.
 */
export async function refreshRatings(): Promise<RatingsReport> {
  const startedAt = Date.now();
  if (!supabaseAdmin) throw new Error("Supabase n'est pas configuré (SUPABASE_SERVICE_ROLE_KEY manquante)");

  const timings: Record<string, number> = {};
  const at = Date.now();
  const rating = await refreshPlayerRatings();
  timings.mmr = Date.now() - at;
  for (const [step, ms] of Object.entries(rating.timings)) timings[`mmr.${step}`] = ms;
  console.log(`[stats] MMR recalculé sur ${rating.matches} parties — ${rating.rated} joueurs classés`);

  const promoteAt = Date.now();
  const promoted = await promoteTrackedPlayers();
  timings.promote = Date.now() - promoteAt;
  if (promoted) console.log(`[stats] ${promoted} joueur(s) passé(s) en suivi dans la file`);

  // Après le classement qu'on vient d'écrire : c'est lui qui dit qui est en haut.
  const ladderAt = Date.now();
  const ladderMarked = await markLadderTop();
  timings.ladderTop = Date.now() - ladderAt;
  if (ladderMarked) console.log(`[stats] ${ladderMarked} joueur(s) entré(s) dans le suivi du haut du classement`);

  const championsAt = Date.now();
  await refreshLadderChampions();
  timings.ladderChampions = Date.now() - championsAt;

  const archiveAt = Date.now();
  const archived = await archiveOldMatches(startedAt);
  timings.archive = Date.now() - archiveAt;
  if (archived) console.log(`[stats] ${archived} match(s) archivé(s)`);

  return {
    ok: true,
    rated: rating.rated,
    matches: rating.matches,
    promoted,
    archived,
    durationMs: Date.now() - startedAt,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
    timings,
  };
}

/**
 * La matérialisation de `participants_published`, à la main.
 *
 * Le rythme horaire, lui, passe par pg_cron à :11 (voir scripts/jobs.ts) :
 * appelée d'ici, la requête traverse la passerelle HTTP, qui la coupe passé la
 * minute. Reste pour la route /api/cron/refresh-stats?only=materialize.
 */
export async function refreshMaterialized(): Promise<{ ok: true; durationMs: number; commit: string }> {
  const startedAt = Date.now();
  if (!supabaseAdmin) throw new Error("Supabase n'est pas configuré (SUPABASE_SERVICE_ROLE_KEY manquante)");
  await refreshPublishedParticipants();
  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
  };
}

/**
 * La publication : agrégations, écriture des snapshots.
 *
 * Lit `player_ratings` tel qu'il est en base — donc tel que `refreshRatings()`
 * l'a laissé au passage précédent. C'est le seul couplage entre les deux
 * phases, et il passe par la base plutôt que par la mémoire du processus.
 */
export async function refreshSnapshots(): Promise<RefreshReport> {
  const startedAt = Date.now();
  const db = supabaseAdmin;
  if (!db) throw new Error("Supabase n'est pas configuré (SUPABASE_SERVICE_ROLE_KEY manquante)");

  const timings: Record<string, number> = {};
  const clock = async <T,>(label: string, run: () => Promise<T>): Promise<T> => {
    const at = Date.now();
    try {
      return await run();
    } finally {
      // `finally` et non après l'await : la phase qui échoue est justement
      // celle qu'on veut chronométrer. Sans ça l'instrumentation se tait au
      // moment précis où elle sert.
      timings[label] = (timings[label] ?? 0) + (Date.now() - at);
    }
  };

  try {
    const context = await clock("patchContext", () => getPatchContext());

    // Le classement n'est plus calculé ici (voir refreshRatings). Le snapshot du
    // classement, lui, reste : il lit `player_ratings` en base, écrit par la
    // phase précédente.

    // Hors patch : ces deux-là ne lisent plus les participants (ce sont des
    // fonctions SQL), ils n'ont donc besoin d'aucun contexte.
    const [site, leaderboard] = await clock("siteEtClassement", () =>
      Promise.all([getSiteStats(), getLeaderboardStats()]),
    );
    const snapshots: SnapshotRow[] = [
      { key: SNAPSHOT_KEYS.site, payload: site },
      { key: SNAPSHOT_KEYS.leaderboard, payload: leaderboard },
    ];

    const published: RefreshReport["patches"] = [];
    const preserved: string[] = [];
    let truncated = false;
    let totalParticipants = 0;

    // Les deux patchs sont lus EN MÊME TEMPS, l'agrégation reste séquentielle.
    //
    // La remarque d'origine — « deux lectures complètes simultanées en mémoire,
    // pour un job qui a tout son temps » — ne tient plus : le job n'a plus tout
    // son temps. Les deux jeux cohabitent bien en mémoire, ce que la version
    // séquentielle évitait ; mais ça représente 142 000 lignes, une trentaine
    // de mégaoctets, sans commune mesure avec ce dont la fonction dispose.
    //
    // Chaque lecture est séquentielle par nature (curseur : il faut le dernier
    // `id` pour demander la page suivante), donc elle passe son temps à
    // attendre. Deux flux, ce n'est pas la lecture parallèle en soixante-cinq
    // requêtes qui avait saturé la base — c'est exactement deux.
    // La table matérialisée qu'on lit ici est rafraîchie par pg_cron à :11,
    // avant cette publication de :17 (voir scripts/jobs.ts).
    const sets = await clock("lectureParticipants", () =>
      Promise.all(context.options.map((option) => readParticipantSetForPatch(option.patch))),
    );
    // Mesuré ICI précisément : c'est le moment où les deux jeux de
    // participations sont entièrement en mémoire, avant que les agrégations
    // n'ajoutent leurs propres structures.
    const heapApresLecture = heapMb();
    const lignesEnMemoire = sets.reduce((n, s) => n + s.rows.length, 0);

    for (const [index, option] of context.options.entries()) {
      const set = sets[index];
      truncated = truncated || set.truncated;
      totalParticipants += set.rows.length;

      // Les paires d'abord : leur fraîcheur décide si deux des calculs les plus
      // lourds de la passe ont lieu ou non.
      const reusable = await clock("pairesReutilisables", () => reusableCombos(option.patch));
      if (reusable.fresh) {
        preserved.push(patchedKey(SNAPSHOT_KEYS.combos, option.patch));
        console.log(
          `[stats] paires de ${option.patch} reprises (calculées il y a ${reusable.ageHours} h) — ${reusable.byChampion.size} pages`,
        );
      }

      const patchSnapshots = await clock("agregation", () =>
        withParticipantSet(set, async () => {
        const [champions, anvil, items, augments, augmentTiming, comps, combos] = await Promise.all([
          getChampionStats(),
          getAnvilChampionStats(itemCategory),
          getItemStats(itemCategory),
          getAugmentStats(),
          getAugmentTimingStats(),
          getCompStats(championRole),
          reusable.fresh
            ? Promise.resolve(reusable.global as Awaited<ReturnType<typeof getComboStats>>)
            : getComboStats(itemCategory),
        ]);

        // Réutilise les champions qu'on vient de calculer : une seule lecture
        // SQL de plus, celle du patch précédent.
        const movers = await getChampionMovers(champions.champions);

        const rows: SnapshotRow[] = [
          { key: SNAPSHOT_KEYS.champions, payload: champions },
          { key: SNAPSHOT_KEYS.movers, payload: movers },
          { key: SNAPSHOT_KEYS.anvil, payload: anvil },
          { key: SNAPSHOT_KEYS.items, payload: items },
          { key: SNAPSHOT_KEYS.augments, payload: augments },
          { key: SNAPSHOT_KEYS.augmentTiming, payload: augmentTiming },
          { key: SNAPSHOT_KEYS.comps, payload: comps },
          // Les paires ne sont RÉÉCRITES que si elles ont été recalculées.
          //
          // Les réécrire à l'identique remettrait `computed_at` à l'heure
          // courante, donc l'horloge des 24 h à zéro — et elles ne seraient
          // plus jamais recalculées. Le site aurait servi des combos figés
          // pour toujours, sans qu'aucune erreur ne le dise. La ligne est
          // donc préservée telle quelle, et son ancienneté reste celle du
          // vrai calcul.
          ...(reusable.fresh ? [] : [{ key: SNAPSHOT_KEYS.combos, payload: combos }]),
        ].map((r) => ({ key: patchedKey(r.key, option.patch), payload: r.payload }));

        // Une entrée par champion réellement joué SUR CE PATCH : un champion
        // absent du patch courant n'a pas de page pour ce patch, ce qui est la
        // bonne réponse plutôt qu'une page vide.
        const details = await Promise.all(
          champions.champions.map(async (c) => {
            const idLower = c.champion.toLowerCase();
            const key = patchedKey(championDetailKey(idLower), option.patch);
            return {
              key,
              payload: await getChampionDetail(
                idLower,
                augmentRarity,
                itemCategory,
                reusable.byChampion.get(key),
              ),
            };
          }),
        );
        rows.push(...details.filter((r) => r.payload !== null));
        return rows;
        }),
      );

      snapshots.push(...patchSnapshots);
      published.push({
        patch: option.patch,
        matches: option.matches,
        participants: set.rows.length,
      });
    }

    const bytes = snapshots.reduce((n, r) => n + JSON.stringify(r.payload).length, 0);
    const computedAt = new Date().toISOString();

    // Écriture par paquets, et plusieurs paquets en vol.
    //
    // Les 362 snapshots partaient en UNE requête de 5 Mo : mesuré 23 s, soit
    // 200 Ko/s, le temps d'un seul aller-retour qui sérialise, transfère et
    // insère de bout en bout sans jamais rien recouvrir.
    //
    // Le prix payé est l'atomicité : un paquet peut aboutir et le suivant
    // échouer. C'est sans conséquence ici, chaque clé étant une page
    // indépendante — au pire deux pages affichent des chiffres calculés à une
    // heure d'écart, ce qui est déjà le cas entre deux publications. Et le
    // ménage qui suit ne s'exécute pas si l'une des écritures a échoué, donc
    // rien n'est supprimé sur la foi d'une publication incomplète.
    const rowsToWrite = snapshots.map((r) => ({
      key: r.key,
      payload: r.payload,
      computed_at: computedAt,
      source_matches: site.totalMatches,
      source_participants: totalParticipants,
      truncated,
    }));
    await clock("ecriture", async () => {
      const chunks: (typeof rowsToWrite)[] = [];
      for (let i = 0; i < rowsToWrite.length; i += SNAPSHOT_CHUNK) {
        chunks.push(rowsToWrite.slice(i, i + SNAPSHOT_CHUNK));
      }
      // Un compteur partagé plutôt qu'un découpage en parts égales : les
      // paquets n'ont pas le même poids (une page de champion pèse mille fois
      // moins que la tier list des objets), et un partage figé ferait attendre
      // tout le monde sur la part la plus lourde.
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(SNAPSHOT_WRITERS, chunks.length) }, async () => {
          for (let i = next++; i < chunks.length; i = next++) {
            const { error } = await db
              .from("stats_snapshots")
              .upsert(chunks[i], { onConflict: "key" });
            if (error) throw error;
          }
        }),
      );
    });

    // Ménage : tout ce qui n'a pas été réécrit ce tour-ci est périmé.
    //
    // Sans ça, les snapshots s'accumulent indéfiniment — les clés sans patch
    // héritées d'avant la découpe, puis le jeu complet de chaque patch qui sort
    // de la fenêtre des deux publiés. Ce sont des lignes que plus personne ne lit
    // mais qui pèsent, et surtout qui pourraient resservir de repli périmé le
    // jour où une clé serait relue par erreur.
    // Le ménage supprime tout ce qui n'a pas été réécrit ce tour-ci. Les paires
    // reprises n'ont PAS été réécrites, justement pour garder leur date : sans
    // cette liste, la passe suivante les effacerait.
    const written = [...snapshots.map((r) => r.key), ...preserved];
    const { error: pruneError, count: pruned } = await clock("menage", async () =>
      db
        .from("stats_snapshots")
        .delete({ count: "exact" })
        .not("key", "in", `(${written.map((k) => `"${k}"`).join(",")})`),
    );
    if (pruneError) throw pruneError;
    if (pruned) console.log(`[stats] ${pruned} snapshot(s) périmé(s) supprimé(s)`);

    return {
      ok: true,
      snapshots: snapshots.length,
      sourceMatches: site.totalMatches,
      sourceParticipants: totalParticipants,
      truncated,
      durationMs: Date.now() - startedAt,
      bytes,
      patches: published,
      memoryMb: {
        apresLecture: heapApresLecture,
        fin: heapMb(),
        plafond: heapLimitMb(),
        lignes: lignesEnMemoire,
      },
      rated: null,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
      timings,
    };
  } catch (cause) {
    // Les erreurs Supabase ne sont pas des `Error` mais des objets
    // { message, details, hint, code } : un String() dessus donne
    // « [object Object] » et masque complètement la cause.
    const message =
      cause instanceof Error
        ? cause.message
        : typeof cause === "object" && cause !== null && "message" in cause
          ? String((cause as { message: unknown }).message)
          : String(cause);
    const error = cause instanceof Error ? cause : new Error(message);
    throw Object.assign(error, { timings });
  }
}
