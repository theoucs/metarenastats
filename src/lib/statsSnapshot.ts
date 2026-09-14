import { supabaseAdmin } from "@/lib/supabase";
import { championRole, itemCategory, resolveAugment } from "@/lib/gameData";
import { getPatchContext, patchedKey } from "@/lib/patches";
import {
  readParticipantSetForPatch,
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

/** Même repli, pour les pages de détail d'un champion (clé dynamique). */
export async function readChampionDetailSnapshot(
  championIdLower: string,
  patch?: string | null,
): Promise<Awaited<ReturnType<typeof getChampionDetail>>> {
  const base = championDetailKey(championIdLower);
  const storageKey = patch ? patchedKey(base, patch) : base;
  const stored = await readSnapshotRaw(storageKey);
  if (stored !== null) return stored as Awaited<ReturnType<typeof getChampionDetail>>;
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
export async function refreshSnapshots(): Promise<RefreshReport> {
  const startedAt = Date.now();
  const db = supabaseAdmin;
  if (!db) throw new Error("Supabase n'est pas configuré (SUPABASE_SERVICE_ROLE_KEY manquante)");

  const context = await getPatchContext();

  // Hors patch : ces deux-là ne lisent plus les participants (ce sont des
  // fonctions SQL), ils n'ont donc besoin d'aucun contexte.
  const [site, leaderboard] = await Promise.all([getSiteStats(), getLeaderboardStats()]);
  const snapshots: SnapshotRow[] = [
    { key: SNAPSHOT_KEYS.site, payload: site },
    { key: SNAPSHOT_KEYS.leaderboard, payload: leaderboard },
  ];

  const published: RefreshReport["patches"] = [];
  let truncated = false;
  let totalParticipants = 0;

  // Séquentiel et non parallèle : deux patchs en parallèle, ce sont deux
  // lectures complètes simultanées en mémoire, pour un job qui a tout son temps.
  for (const option of context.options) {
    const set = await readParticipantSetForPatch(option.patch);
    truncated = truncated || set.truncated;
    totalParticipants += set.rows.length;

    const patchSnapshots = await withParticipantSet(set, async () => {
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
    });

    snapshots.push(...patchSnapshots);
    published.push({
      patch: option.patch,
      matches: option.matches,
      participants: set.rows.length,
    });
  }

  const bytes = snapshots.reduce((n, r) => n + JSON.stringify(r.payload).length, 0);
  const computedAt = new Date().toISOString();

  const { error } = await db.from("stats_snapshots").upsert(
    snapshots.map((r) => ({
      key: r.key,
      payload: r.payload,
      computed_at: computedAt,
      source_matches: site.totalMatches,
      source_participants: totalParticipants,
      truncated,
    })),
    { onConflict: "key" },
  );
  if (error) throw error;

  // Ménage : tout ce qui n'a pas été réécrit ce tour-ci est périmé.
  //
  // Sans ça, les snapshots s'accumulent indéfiniment — les clés sans patch
  // héritées d'avant la découpe, puis le jeu complet de chaque patch qui sort
  // de la fenêtre des deux publiés. Ce sont des lignes que plus personne ne lit
  // mais qui pèsent, et surtout qui pourraient resservir de repli périmé le
  // jour où une clé serait relue par erreur.
  const written = snapshots.map((r) => r.key);
  const { error: pruneError, count: pruned } = await db
    .from("stats_snapshots")
    .delete({ count: "exact" })
    .not("key", "in", `(${written.map((k) => `"${k}"`).join(",")})`);
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
  };
}
