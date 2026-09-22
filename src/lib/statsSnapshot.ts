import { supabaseAdmin } from "@/lib/supabase";
import { championRole, itemCategory, resolveAugment } from "@/lib/gameData";
import { getPatchContext, patchedKey } from "@/lib/patches";
import { promoteTrackedPlayers, refreshPlayerRatings } from "@/lib/playerRatings";
import {
  readParticipantSetForPatch,
  refreshPublishedParticipants,
  withParticipantSet,
  getAnvilChampionStats,
  getAugmentStats,
  getAugmentTimingStats,
  getChampionDetail,
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

export type RatingsReport = {
  ok: boolean;
  rated: number;
  matches: number;
  promoted: number;
  durationMs: number;
  commit: string;
  timings: Record<string, number>;
};

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

  return {
    ok: true,
    rated: rating.rated,
    matches: rating.matches,
    promoted,
    durationMs: Date.now() - startedAt,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
    timings,
  };
}

/**
 * La publication : matérialisation, agrégations, écriture des snapshots.
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
    // APRÈS la passe MMR, qui vient de réécrire `player_ratings` : la table
    // matérialisée fige le `skill_bucket`, elle doit donc figer le tout dernier.
    // Et AVANT la lecture, évidemment — c'est elle qu'on va lire.
    await clock("materialisation", () => refreshPublishedParticipants());

    const sets = await clock("lectureParticipants", () =>
      Promise.all(context.options.map((option) => readParticipantSetForPatch(option.patch))),
    );

    for (const [index, option] of context.options.entries()) {
      const set = sets[index];
      truncated = truncated || set.truncated;
      totalParticipants += set.rows.length;

      const patchSnapshots = await clock("agregation", () =>
        withParticipantSet(set, async () => {
        const [champions, anvil, items, augments, augmentTiming, comps, combos] = await Promise.all([
          getChampionStats(),
          getAnvilChampionStats(itemCategory),
          getItemStats(itemCategory),
          getAugmentStats(),
          getAugmentTimingStats(),
          getCompStats(championRole),
          getComboStats(itemCategory),
        ]);

        const rows: SnapshotRow[] = [
          { key: SNAPSHOT_KEYS.champions, payload: champions },
          { key: SNAPSHOT_KEYS.anvil, payload: anvil },
          { key: SNAPSHOT_KEYS.items, payload: items },
          { key: SNAPSHOT_KEYS.augments, payload: augments },
          { key: SNAPSHOT_KEYS.augmentTiming, payload: augmentTiming },
          { key: SNAPSHOT_KEYS.comps, payload: comps },
          { key: SNAPSHOT_KEYS.combos, payload: combos },
        ].map((r) => ({ key: patchedKey(r.key, option.patch), payload: r.payload }));

        // Une entrée par champion réellement joué SUR CE PATCH : un champion
        // absent du patch courant n'a pas de page pour ce patch, ce qui est la
        // bonne réponse plutôt qu'une page vide.
        const details = await Promise.all(
          champions.champions.map(async (c) => {
            const idLower = c.champion.toLowerCase();
            return {
              key: patchedKey(championDetailKey(idLower), option.patch),
              payload: await getChampionDetail(idLower, augmentRarity, itemCategory),
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
    const written = snapshots.map((r) => r.key);
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
