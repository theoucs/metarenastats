import { supabaseAdmin } from "@/lib/supabase";
import { championRole, itemCategory, resolveAugment } from "@/lib/gameData";
import {
  fetchParticipantSet,
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
): Promise<SnapshotPayloads[K]> {
  const stored = await readSnapshotRaw(SNAPSHOT_KEYS[key]);
  if (stored !== null) return stored as SnapshotPayloads[K];
  console.warn(`[stats] snapshot "${SNAPSHOT_KEYS[key]}" absent — calcul direct (le cron a-t-il tourné ?)`);
  return compute();
}

/** Même repli, pour les pages de détail d'un champion (clé dynamique). */
export async function readChampionDetailSnapshot(
  championIdLower: string,
): Promise<Awaited<ReturnType<typeof getChampionDetail>>> {
  const stored = await readSnapshotRaw(championDetailKey(championIdLower));
  if (stored !== null) return stored as Awaited<ReturnType<typeof getChampionDetail>>;
  console.warn(`[stats] snapshot champion "${championIdLower}" absent — calcul direct`);
  return getChampionDetail(championIdLower, augmentRarity, itemCategory);
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
};

/**
 * Recalcule et réécrit tous les snapshots. Appelé par le cron, jamais par une
 * page.
 *
 * Tous les agrégateurs partagent une seule lecture de `match_participants`,
 * propagée par `withParticipantSet`. Ne pas remplacer ça par le `cache()` de
 * React : il ne s'applique pas dans un route handler, et sans le contexte
 * explicite un rafraîchissement relit la base 184 fois (mesuré).
 */
export async function refreshSnapshots(): Promise<RefreshReport> {
  const startedAt = Date.now();
  const db = supabaseAdmin;
  if (!db) throw new Error("Supabase n'est pas configuré (SUPABASE_SERVICE_ROLE_KEY manquante)");

  // Une seule lecture de la table, réutilisée par tous les agrégateurs via le
  // contexte asynchrone.
  const participantSet = await fetchParticipantSet();
  const { rows: participants, truncated } = participantSet;

  return withParticipantSet(participantSet, async () => {
    const [site, champions, anvil, items, augments, augmentTiming, leaderboard, comps, combos] =
      await Promise.all([
        getSiteStats(),
        getChampionStats(),
        getAnvilChampionStats(itemCategory),
        getItemStats(itemCategory),
        getAugmentStats(),
        getAugmentTimingStats(),
        getLeaderboardStats(),
        getCompStats(championRole),
        getComboStats(itemCategory),
      ]);

    const snapshots: SnapshotRow[] = [
      { key: SNAPSHOT_KEYS.site, payload: site },
      { key: SNAPSHOT_KEYS.champions, payload: champions },
      { key: SNAPSHOT_KEYS.anvil, payload: anvil },
      { key: SNAPSHOT_KEYS.items, payload: items },
      { key: SNAPSHOT_KEYS.augments, payload: augments },
      { key: SNAPSHOT_KEYS.augmentTiming, payload: augmentTiming },
      { key: SNAPSHOT_KEYS.leaderboard, payload: leaderboard },
      { key: SNAPSHOT_KEYS.comps, payload: comps },
      { key: SNAPSHOT_KEYS.combos, payload: combos },
    ];

    // Une entrée par champion réellement joué, pour que /champions/[slug] soit
    // servi depuis un snapshot comme les autres pages.
    const championDetails = await Promise.all(
      champions.champions.map(async (c) => {
        const idLower = c.champion.toLowerCase();
        return {
          key: championDetailKey(idLower),
          payload: await getChampionDetail(idLower, augmentRarity, itemCategory),
        };
      }),
    );
    snapshots.push(...championDetails.filter((s) => s.payload !== null));

    const sourceMatches = site.totalMatches;
    const bytes = snapshots.reduce((n, s) => n + JSON.stringify(s.payload).length, 0);
    const computedAt = new Date().toISOString();

    const { error } = await db.from("stats_snapshots").upsert(
      snapshots.map((s) => ({
        key: s.key,
        payload: s.payload,
        computed_at: computedAt,
        source_matches: sourceMatches,
        source_participants: participants.length,
        truncated,
      })),
      { onConflict: "key" },
    );
    if (error) throw error;

    return {
      ok: true,
      snapshots: snapshots.length,
      sourceMatches,
      sourceParticipants: participants.length,
      truncated,
      durationMs: Date.now() - startedAt,
      bytes,
    };
  });
}
