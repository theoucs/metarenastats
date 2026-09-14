import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import { computeTiers } from "@/lib/tiers";
import { augmentCategory } from "@/lib/gameData";

export type ParticipantRow = {
  match_id: string;
  subteam_id: number;
  champion: string;
  placement: number;
  augments: number[];
  items: number[];
  /** Ordre d'achat réel, depuis le Match Timeline (voir lib/timeline.ts).
   *  `null` tant que la passe timeline n'a pas traité ce match — l'agrégation
   *  retombe alors sur `items`, comme avant. Ne contient que les achats en
   *  boutique : les prismatiques n'y figurent jamais. */
  item_order: number[] | null;
};

// Arena is 6 teams of 3 — top half (placement <= 3) is what we surface as
// "% Top 3", matching what Riot's own `win` boolean reflected in the old
// 2v2 format.
export const TOP3_PLACEMENT_THRESHOLD = 3;

// 6 teams of 3 — used to turn a match count into a participant-slot count for
// "% Played" on champions/items/augments (each of the 18 slots independently
// picks a champion / can include a given item or augment in its build, so the
// pick-rate denominator is matches × 18, not matches).
const PARTICIPANTS_PER_MATCH = 18;

// Nombre de slots de build suivis par champion (voir getChampionDetail).
//
// Depuis le 2026-09-14 ces slots s'appuient sur l'ordre d'achat réel
// (`item_order`, extrait du Match Timeline) et non plus sur `items`, qui
// conserve l'ordre des slots d'inventaire de Riot — un ordre qui n'a rien à
// voir avec celui des achats, contrairement à ce que disait ce commentaire.
const BUILD_SLOT_COUNT = 6;

/** Slot 1 : les bottes. Mesuré sur 108 participants, 87 % des joueurs les
 *  achètent en premier — c'est le seul slot dont la position reflète un vrai
 *  ordre de début de partie. */
const BOOTS_SLOT = 1;

/** Slot 2 : le prismatique.
 *
 *  ⚠️ Position de présentation, pas un ordre mesuré. Les prismatiques ne sont
 *  jamais achetés en boutique et n'apparaissent donc pas dans le timeline (20
 *  visibles contre 183 possédés) ; impossible de savoir lequel est arrivé en
 *  premier quand un joueur en a plusieurs, ce qui est le cas de 51 % d'entre
 *  eux. La piste de l'enclume `220007` pour les dater a été vérifiée et écartée
 *  (61 joueurs sur 108 n'en reçoivent aucune tout en ayant des prismatiques).
 *  Ce slot agrège donc TOUS les prismatiques possédés, et fait ressortir le
 *  plus fréquent sur ce champion. Décision prise avec Théo le 2026-09-14. */
const PRISMATIC_SLOT = 2;
const ALTS_PER_SLOT = 3; // 1 primary + 2 alternates

// Supabase/PostgREST caps every response at 1000 rows server-side (the "Max Rows"
// project setting) regardless of the .limit() a client asks for — paginate with
// .range() to actually fetch everything.
const PAGE_SIZE = 1000;

// Ce chemin ne sert plus une requête utilisateur : depuis 2026-09-13 les pages
// lisent des snapshots pré-calculés (lib/statsSnapshot.ts) et seul le job de
// rafraîchissement appelle les agrégateurs. Il n'a pas de pression de latence,
// d'où un plafond bien plus haut que les 30 pages d'avant (qui tronquaient dès
// ~1 660 matchs).
//
// 500 pages = 500 000 lignes ≈ 28 000 matchs, soit ~100 Mo en mémoire JS. Le
// plafond reste un garde-fou mémoire, pas une limite de conception : au-delà,
// l'agrégation doit passer en SQL (phase 3 du plan). La différence essentielle
// avec l'ancienne version est que la troncature n'est plus muette.
const MAX_PAGES = 500;

/**
 * Wrapped in React's `cache` so a page that runs two aggregators pays for one
 * trip to Supabase, not two — these are Supabase calls, not `fetch`, so they
 * get no automatic request memoization (see Next's glossary entry). The
 * Augments page needs the tier list and the pick-timing stats from the same
 * rows; the champion detail page was already paying twice before this.
 *
 * Per-request only: the cache lives for one render pass, so pages still see
 * fresh data on every request.
 */
/**
 * Les colonnes de la lecture partagée — et ce qu'elles NE contiennent plus.
 *
 * `puuid` et `riot_id` en sont sortis le 2026-09-14. Mesuré sur 1 000 lignes
 * compressées, telles qu'elles voyagent réellement : la ligne complète pesait
 * 109 o, dont **67 pour ces deux colonnes seules — 61 % de l'egress** d'un
 * rafraîchissement. Un puuid fait 78 caractères aléatoires : il ne se compresse
 * pas, contrairement au reste.
 *
 * Or un seul agrégateur en avait besoin, le classement, qui est désormais
 * calculé dans Postgres (fonction `leaderboard_stats`). Ce qui reste ici est ce
 * dont le calcul JS a vraiment besoin : **31 o par ligne, 3,5× moins**.
 */
const PARTICIPANT_COLUMNS =
  "match_id, subteam_id, champion, placement, augments, items, item_order";

/**
 * La vue `participants_clean` plutôt que la table brute.
 *
 * Elle applique déjà l'exclusion des équipes AFK. Le « Anvil Voucher »
 * (220008-220011) est l'écran de choix d'une enclume : il se consomme en une
 * minute de jeu normal, donc en trouver un dans un inventaire FINAL signifie
 * que le joueur n'a jamais joué. Riot enregistre quand même un placement pour
 * son équipe, mais ce placement reflète un 2v3, pas une performance — toute
 * l'équipe sort donc des stats pour ce match.
 *
 * La vue porte aussi le patch de la partie, ce qui permet de filtrer par patch
 * DANS Postgres au lieu de tout lire pour trier ensuite.
 *
 * Conséquence : `dropAfkTeams()` a disparu du chemin JS. La règle n'est pas
 * dupliquée, elle a changé d'endroit, et elle s'applique désormais aussi aux
 * fonctions SQL (classement, compteurs), qui la contournaient auparavant.
 */
const PARTICIPANT_SOURCE = "participants_clean";

/**
 * Fetches one page. Split out from fetchAllParticipants so pages can be
 * requested with Promise.all instead of a sequential loop — at ~13k rows/14
 * pages, one-at-a-time round trips added up to several seconds per page load
 * and occasionally tipped over the platform's request timeout.
 *
 * ⚠️ `.order("id")` n'est PAS cosmétique. Un `.range()` sans tri laisse
 * Postgres libre de renvoyer les lignes dans l'ordre qu'il veut, et ces pages
 * partent en parallèle : rien ne garantit que deux requêtes voient le même
 * ordre. Des pages se recouvrent, d'autres lignes ne sont jamais lues.
 *
 * Le défaut existait déjà sur la table brute, où l'ordre du disque le masquait.
 * Le passage à une vue avec jointure l'a révélé immédiatement : 2 051 matchs
 * agrégés au lieu de 2 087, et des chiffres faux sur 172 champions sur 173.
 */
function fetchParticipantPage(page: number, patch: string | null) {
  if (!supabaseAdmin) return Promise.resolve<ParticipantRow[]>([]);
  const from = page * PAGE_SIZE;
  let query = supabaseAdmin
    .from(PARTICIPANT_SOURCE)
    .select(PARTICIPANT_COLUMNS)
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  // Le filtre part en SQL : on ne lit que les lignes du patch demandé au lieu
  // de tout charger pour trier ensuite. Découper par patch coûte donc moins
  // d'egress qu'avant, pas plus. `patch` n'est jamais dans les colonnes
  // sélectionnées — filtrer dessus n'oblige pas à le transporter.
  if (patch) query = query.eq("patch", patch);
  return query.then(({ data, error }) => {
    if (error) throw error;
    return data ?? [];
  });
}

export type ParticipantSet = {
  rows: ParticipantRow[];
  /** Nombre de lignes réellement présentes en base, avant plafonnement. */
  totalRows: number;
  /** true si MAX_PAGES a coupé la lecture : les stats calculées là-dessus sont
   * partielles. Signalé explicitement pour ne plus jamais être silencieux. */
  truncated: boolean;
};

/**
 * Jeu de participants déjà chargé, propagé à tous les agrégateurs d'un même
 * calcul.
 *
 * Le `cache()` de React ne suffit pas ici : mesuré le 2026-09-13, un
 * rafraîchissement complet des snapshots relançait **184 lectures intégrales**
 * de `match_participants` (une par agrégateur et par champion). La mémoïsation
 * de React est liée au rendu d'un composant serveur et n'opère pas dans un
 * route handler — d'où ce contexte asynchrone explicite, qui lui fonctionne
 * partout et ne fuit pas entre requêtes concurrentes.
 */
const participantSetStore = new AsyncLocalStorage<ParticipantSet>();

/** Exécute `fn` en réutilisant `set` pour tout appel à `fetchParticipantSet`. */
export function withParticipantSet<T>(set: ParticipantSet, fn: () => Promise<T>): Promise<T> {
  return participantSetStore.run(set, fn);
}

/** Lecture brute paginée, partagée par tous les agrégateurs d'un même calcul. */
export async function fetchParticipantSet(patch: string | null = null): Promise<ParticipantSet> {
  // Le contexte l'emporte quand il est posé (job de snapshot) ; sinon on
  // retombe sur la mémoïsation React, qui elle fonctionne au rendu d'une page.
  //
  // `patch` ne sert donc qu'au chemin de repli : quand un contexte est posé, il
  // a DÉJÀ été filtré par le patch voulu, et les agrégateurs n'ont pas à le
  // savoir. C'est ce qui évite de propager un paramètre de patch dans les douze
  // signatures d'agrégateurs.
  return participantSetStore.getStore() ?? readParticipantSet(patch);
}

const readParticipantSet = cache(async function readParticipantSet(
  patch: string | null,
): Promise<ParticipantSet> {
  if (!supabaseAdmin) return { rows: [], totalRows: 0, truncated: false };

  const countQuery = supabaseAdmin.from(PARTICIPANT_SOURCE).select("*", { count: "exact", head: true });
  const { count, error } = await (patch ? countQuery.eq("patch", patch) : countQuery);
  if (error) throw error;

  const totalRows = count ?? 0;
  const neededPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const pageCount = Math.min(neededPages, MAX_PAGES);
  const truncated = neededPages > MAX_PAGES;

  if (truncated) {
    console.error(
      `[aggregate] TRONCATURE : ${totalRows} lignes en base, seules ${MAX_PAGES * PAGE_SIZE} ont été lues. ` +
        `Les stats calculées sont partielles — il faut passer l'agrégation en SQL (phase 3 du plan).`,
    );
  }

  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, page) => fetchParticipantPage(page, patch)),
  );
  return { rows: dropExcludedAugments(pages.flat()), totalRows, truncated };
});

export async function fetchAllParticipants(): Promise<ParticipantRow[]> {
  return (await fetchParticipantSet()).rows;
}

/** Lecture ciblée d'un patch, pour le job de snapshots et le repli des pages. */
export async function readParticipantSetForPatch(patch: string | null): Promise<ParticipantSet> {
  return readParticipantSet(patch);
}

// Strips one-off event augments (see gameData's augmentCategory) out of every
// row's augment list before any stat sees them — done once here rather than
// at each of the four places augments get aggregated, so nothing can miss it.
function dropExcludedAugments(rows: ParticipantRow[]): ParticipantRow[] {
  return rows.map((r) =>
    r.augments.some((id) => augmentCategory(id) === "excluded")
      ? { ...r, augments: r.augments.filter((id) => augmentCategory(id) !== "excluded") }
      : r,
  );
}

// Rows are per-participant (18 per match, since we save all 6 teams) — the
// number of *matches* tracked is the count of distinct match IDs, not rows.
function countMatches(rows: ParticipantRow[]): number {
  return new Set(rows.map((r) => r.match_id)).size;
}

/**
 * Les trois compteurs de l'accueil, comptés par Postgres.
 *
 * C'était la dernière raison de faire voyager `puuid` : 78 octets par ligne,
 * 27 000 lignes, pour produire un entier. `site_totals()` applique exactement
 * le même filtre (la vue `participants_clean` = moins les équipes AFK).
 */
export async function getSiteStats() {
  if (!supabaseAdmin) return { totalMatches: 0, totalChampions: 0, totalPlayers: 0 };
  const { data, error } = await supabaseAdmin.rpc("site_totals");
  if (error) throw error;
  const totals = data?.[0];
  return {
    totalMatches: Number(totals?.total_matches ?? 0),
    totalChampions: Number(totals?.total_champions ?? 0),
    totalPlayers: Number(totals?.total_players ?? 0),
  };
}

export type Stat = {
  games: number;
  top3Rate: number;
  top1Rate: number;
  avgPlacement: number;
  /** % of the reference population (all matches, or a champion's matches) that includes this entity. */
  playRate: number;
};

type Accumulator = { games: number; top3Wins: number; top1Wins: number; placementSum: number };

// `denominator` is what "playRate" is a percentage of — total matches for the
// site-wide tables, or one champion's game count for stats scoped to that champion.
function toStat(s: Accumulator, denominator: number): Stat {
  return {
    games: s.games,
    top3Rate: s.games > 0 ? s.top3Wins / s.games : 0,
    top1Rate: s.games > 0 ? s.top1Wins / s.games : 0,
    avgPlacement: s.games > 0 ? s.placementSum / s.games : 0,
    playRate: denominator > 0 ? s.games / denominator : 0,
  };
}

function accumulate(map: Map<string | number, Accumulator>, key: string | number, placement: number) {
  const entry = map.get(key) ?? { games: 0, top3Wins: 0, top1Wins: 0, placementSum: 0 };
  entry.games += 1;
  entry.placementSum += placement;
  if (placement <= TOP3_PLACEMENT_THRESHOLD) entry.top3Wins += 1;
  if (placement === 1) entry.top1Wins += 1;
  map.set(key, entry);
}

export async function getChampionStats() {
  const rows = await fetchAllParticipants();
  const totalMatches = countMatches(rows);
  const byChampion = new Map<string, Accumulator>();
  for (const r of rows) accumulate(byChampion, r.champion, r.placement);
  const champions = Array.from(byChampion.entries())
    .map(([champion, s]) => ({ champion, ...toStat(s, totalMatches * PARTICIPANTS_PER_MATCH) }))
    .sort((a, b) => b.top3Rate - a.top3Rate);
  return { totalMatches, champions };
}

// Same shape as getChampionStats, scoped to participants playing an "anvil
// run" (see isAnvilBuild below) — powers the dedicated Anvil Run tier list.
// playRate here is "% of this champion's own games (any playstyle) that were
// an anvil run" rather than a pick rate over the anvil population — matching
// the anvilStat.playRate shown on the champion detail page.
export async function getAnvilChampionStats(itemCategoryOf: ItemCategoryLookup) {
  const rows = await fetchAllParticipants();
  const totalGamesByChampion = new Map<string, number>();
  for (const r of rows) {
    totalGamesByChampion.set(r.champion, (totalGamesByChampion.get(r.champion) ?? 0) + 1);
  }

  const anvilRows = rows.filter((r) => isAnvilBuild(r.items, itemCategoryOf));
  const totalMatches = countMatches(anvilRows);
  const byChampion = new Map<string, Accumulator>();
  for (const r of anvilRows) accumulate(byChampion, r.champion, r.placement);
  const champions = Array.from(byChampion.entries())
    .map(([champion, s]) => ({
      champion,
      ...toStat(s, totalGamesByChampion.get(champion) ?? 0),
    }))
    .sort((a, b) => b.top3Rate - a.top3Rate);
  return { totalMatches, champions };
}

// "excluded" items (quest-only rewards like Shardblade, or auto-granted ones
// like Arcane Sweeper) are never a real shop choice — so they're excluded
// from item stats/recommendations wherever this is passed.
type ItemCategoryLookup = (itemId: number) => "boots" | "prismatic" | "excluded" | undefined;

// Shared with the champion page, which needs the id to resolve the icon for
// the "% of anvil games that got a Shardblade" stat.
export const SHARDBLADE_ITEM_ID = 220012;

export async function getItemStats(categoryOf: ItemCategoryLookup) {
  const rows = await fetchAllParticipants();
  const totalMatches = countMatches(rows);
  const byItem = new Map<number, Accumulator>();
  for (const r of rows) {
    for (const itemId of r.items) {
      if (categoryOf(itemId) === "excluded") continue;
      accumulate(byItem, itemId, r.placement);
    }
  }
  const items = Array.from(byItem.entries())
    .map(([itemId, s]) => ({ itemId, ...toStat(s, totalMatches * PARTICIPANTS_PER_MATCH) }))
    .sort((a, b) => b.top3Rate - a.top3Rate);
  return { totalMatches, items };
}

export async function getAugmentStats() {
  const rows = await fetchAllParticipants();
  const totalMatches = countMatches(rows);
  const byAugment = new Map<number, Accumulator>();
  for (const r of rows) {
    for (const augmentId of r.augments) accumulate(byAugment, augmentId, r.placement);
  }
  const augments = Array.from(byAugment.entries())
    .map(([augmentId, s]) => ({ augmentId, ...toStat(s, totalMatches * PARTICIPANTS_PER_MATCH) }))
    .sort((a, b) => b.top3Rate - a.top3Rate);
  return { totalMatches, augments };
}

/**
 * Parties minimum pour figurer au classement.
 *
 * Mesuré le 2026-09-14 : **14 131 des 17 588 joueurs suivis n'avaient qu'une
 * seule partie**. À une partie on fait 0 % ou 100 % de top 3 — ces lignes ne
 * classent personne, elles ne font que peser : le snapshot du classement
 * atteignait 3,6 Mo, plus qu'une lecture complète de la base, relu à chaque
 * régénération de la page.
 *
 * 5 est un point de départ assumé, pas une méthodologie (voir /info : le vrai
 * classement reste à concevoir, phase 4 du plan). Une seule ligne à changer.
 */
const LEADERBOARD_MIN_GAMES = 5;

type LeaderboardRpcRow = {
  puuid: string;
  riot_id: string;
  games: number;
  top3_wins: number;
  top1_wins: number;
  placement_sum: number;
};

/**
 * Classement, agrégé par Postgres (`leaderboard_stats`).
 *
 * Seul agrégateur à avoir besoin de `puuid`/`riot_id`, les deux colonnes les
 * plus lourdes de la table — d'où ce chemin distinct, qui les laisse en base.
 * Le calcul lui-même ne change pas : la fonction SQL renvoie les compteurs
 * bruts et `toStat` les met en forme comme pour tous les autres tableaux.
 */
export async function getLeaderboardStats() {
  if (!supabaseAdmin) return { totalMatches: 0, players: [] };

  // Le classement (rang + palier) est calculé à part, dans lib/playerRatings.ts,
  // et lu ici : il demande de rejouer toute l'histoire dans l'ordre, ce qu'une
  // fonction SQL d'agrégation ne sait pas faire.
  const [{ totalMatches }, { data, error }, { data: ranks, error: rankError }] = await Promise.all([
    getSiteStats(),
    supabaseAdmin.rpc("leaderboard_stats", { min_games: LEADERBOARD_MIN_GAMES }),
    supabaseAdmin.from("player_ratings").select("puuid, tier, rank_position"),
  ]);
  if (error) throw error;
  if (rankError) throw rankError;

  const rankByPuuid = new Map(
    ((ranks ?? []) as { puuid: string; tier: string; rank_position: number }[]).map((r) => [
      r.puuid,
      r,
    ]),
  );

  const players = ((data ?? []) as LeaderboardRpcRow[])
    .map((r) => {
      const rank = rankByPuuid.get(r.puuid);
      return {
        puuid: r.puuid,
        riotId: r.riot_id,
        tier: rank?.tier ?? null,
        position: rank?.rank_position ?? null,
        ...toStat(
          {
            games: Number(r.games),
            top3Wins: Number(r.top3_wins),
            top1Wins: Number(r.top1_wins),
            placementSum: Number(r.placement_sum),
          },
          totalMatches,
        ),
      };
    })
    // Le rang d'abord. Un joueur sans rang ne devrait pas exister ici (même
    // seuil, même source), mais s'il en apparaît un, il passe en fin de liste
    // plutôt qu'en tête d'un classement où il n'a rien à faire.
    .sort(
      (a, b) =>
        (a.position ?? Infinity) - (b.position ?? Infinity) ||
        b.top3Rate - a.top3Rate ||
        b.games - a.games,
    );

  return { totalMatches, players };
}

export type PlayerChampionStat = { champion: string } & Stat;

export type PlayerProfile = {
  games: number;
  top1Rate: number;
  top3Rate: number;
  avgPlacement: number;
  /** Every champion this player has been tracked on, across all their known
   * games (any playstyle) — playRate is this champion's share of their games. */
  champions: PlayerChampionStat[];
};

/**
 * Les lignes d'un seul joueur, lues par une requête ciblée sur son `puuid`
 * (index `match_participants_puuid_idx`).
 *
 * La page joueur est la seule page qui doit rester dynamique — elle déclenche
 * un appel Riot en direct — donc elle ne peut pas passer par un snapshot. Elle
 * chargeait pourtant TOUTE la base pour n'en garder qu'un joueur : ~240 000
 * lignes lues pour en afficher 30. Ici on lit les ~N lignes du joueur.
 *
 * L'exclusion des équipes AFK vient de la vue `participants_clean`, comme pour
 * les tableaux du site. Elle demandait auparavant une seconde requête ici —
 * savoir si un *coéquipier* avait fini avec un voucher n'est pas une propriété
 * de la ligne du joueur — et donc une deuxième écriture de la même règle, qui
 * pouvait diverger de celle des tier lists. Une seule définition désormais,
 * en SQL.
 *
 * `dropExcludedAugments` reste ici : il dépend des catégories d'augments, qui
 * vivent dans les JSON côté app.
 */
async function fetchPlayerRows(puuid: string): Promise<ParticipantRow[]> {
  if (!supabaseAdmin) return [];

  const rows: ParticipantRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from(PARTICIPANT_SOURCE)
      .select(PARTICIPANT_COLUMNS)
      .eq("puuid", puuid)
      .order("id", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as ParticipantRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return dropExcludedAugments(rows);
}

/** Everything about one player scoped to their own games (all matches we've
 * ever stored involving this puuid, not just the ones from the most recent
 * search) — powers the player profile page. */
export async function getPlayerProfile(puuid: string): Promise<PlayerProfile> {
  const playerRows = await fetchPlayerRows(puuid);
  const totalGames = playerRows.length;

  const overallAcc: Accumulator = { games: 0, top3Wins: 0, top1Wins: 0, placementSum: 0 };
  const byChampion = new Map<string, Accumulator>();
  for (const r of playerRows) {
    overallAcc.games += 1;
    overallAcc.placementSum += r.placement;
    if (r.placement <= TOP3_PLACEMENT_THRESHOLD) overallAcc.top3Wins += 1;
    if (r.placement === 1) overallAcc.top1Wins += 1;
    accumulate(byChampion, r.champion, r.placement);
  }

  const champions = Array.from(byChampion.entries())
    .map(([champion, s]) => ({ champion, ...toStat(s, totalGames) }))
    .sort((a, b) => b.games - a.games);

  return {
    games: totalGames,
    top1Rate: totalGames > 0 ? overallAcc.top1Wins / totalGames : 0,
    top3Rate: totalGames > 0 ? overallAcc.top3Wins / totalGames : 0,
    avgPlacement: totalGames > 0 ? overallAcc.placementSum / totalGames : 0,
    champions,
  };
}

export type ChampionAugmentStat = { augmentId: number } & Stat;
export type ChampionItemSlotStat = { itemId: number } & Stat;
export type ChampionItemSlot = { slot: number; items: ChampionItemSlotStat[] };

export type ChampionDetail = {
  champion: string; // canonical id as stored (Riot casing) — caller resolves display info
  totalMatches: number;
} & Stat & {
    augmentsByRarity: Record<"silver" | "gold" | "prismatic", ChampionAugmentStat[]>;
    itemBuild: ChampionItemSlot[];
    /** Top 6 Prismatic items across this champion's games (any playstyle), ranked by tier score. */
    topPrismaticItems: ChampionItemSlotStat[];
    /** Stats for the "anvil run" playstyle (stat anvils instead of items) — see isAnvilBuild. */
    anvilStat: Stat;
    /** % of this champion's anvil-run games (not all games) where Shardblade was obtained. */
    anvilShardbladeRate: number;
    /** Top 3 Prismatic items among this champion's anvil-run games, ranked by tier score. */
    anvilTopPrismaticItems: ChampionItemSlotStat[];
    /** Top 10 combos per category, scoped to this champion's own games. */
    championCombos: Record<ComboCategory, ComboStat[]>;
  };

// A participant is playing an "anvil run" if every item in their final
// inventory is either a free Prismatic item or an "excluded" item (Shardblade,
// Arcane Sweeper, ...) — i.e. they bought zero boots and zero normal shop
// items. Neither category requires spending gold, so their presence doesn't
// disqualify the run; a plain Legendary/Mythic item or a pair of boots does.
function isAnvilBuild(items: number[], categoryOf: ItemCategoryLookup): boolean {
  return items.every((id) => {
    const category = categoryOf(id);
    return category === "prismatic" || category === "excluded";
  });
}

// Prismatic items seen across `rows`, ranked by the same tier score as the
// augments/tier lists (games, avg placement, %top1, %top3) and cut down to
// the top `topN`. `denominator` is what "playRate" is relative to — e.g.
// this champion's total games, or just its anvil-run games.
function computeTopPrismaticItems(
  rows: ParticipantRow[],
  categoryOf: ItemCategoryLookup,
  denominator: number,
  topN: number
): ChampionItemSlotStat[] {
  const byItem = new Map<number, Accumulator>();
  for (const r of rows) {
    for (const itemId of r.items) {
      if (categoryOf(itemId) !== "prismatic") continue;
      accumulate(byItem, itemId, r.placement);
    }
  }
  const stats = Array.from(byItem.entries()).map(([itemId, s]) => ({ itemId, ...toStat(s, denominator) }));
  const tierMap = computeTiers(stats.map((s) => ({ ...s, key: String(s.itemId) })));
  stats.sort((a, b) => tierMap.get(String(b.itemId))!.score - tierMap.get(String(a.itemId))!.score);
  return stats.slice(0, topN);
}

/**
 * Everything about one champion: overall stats (scoped to all tracked matches,
 * so playRate = pick rate), best augments (scoped to this champion's own
 * games, so playRate = how often that augment shows up when this champion is
 * played), and a per-slot item build (see BUILD_SLOT_COUNT comment above).
 */
export async function getChampionDetail(
  championIdLower: string,
  rarityOf: (augmentId: number) => "silver" | "gold" | "prismatic" | undefined,
  itemCategoryOf: ItemCategoryLookup
): Promise<ChampionDetail | null> {
  const rows = await fetchAllParticipants();
  const totalMatches = countMatches(rows);
  const champRows = rows.filter((r) => r.champion.toLowerCase() === championIdLower);
  if (champRows.length === 0) return null;

  const championAcc: Accumulator = { games: 0, top3Wins: 0, top1Wins: 0, placementSum: 0 };
  for (const r of champRows) {
    championAcc.games += 1;
    championAcc.placementSum += r.placement;
    if (r.placement <= TOP3_PLACEMENT_THRESHOLD) championAcc.top3Wins += 1;
    if (r.placement === 1) championAcc.top1Wins += 1;
  }
  const champGames = champRows.length;

  // Augments used on this champion, split by rarity, top 5 each. "Best" uses
  // the same tier score as the tier lists (games, avg placement, %top1,
  // %top3) rather than raw %top3, so a 2-game 100%-top3 augment doesn't
  // outrank a proven 40-game pick.
  const byAugment = new Map<number, Accumulator>();
  for (const r of champRows) {
    for (const augmentId of r.augments) accumulate(byAugment, augmentId, r.placement);
  }
  const augmentsByRarity: ChampionDetail["augmentsByRarity"] = { silver: [], gold: [], prismatic: [] };
  for (const [augmentId, s] of byAugment.entries()) {
    const rarity = rarityOf(augmentId);
    if (!rarity) continue;
    augmentsByRarity[rarity].push({ augmentId, ...toStat(s, champGames) });
  }
  for (const rarity of Object.keys(augmentsByRarity) as (keyof typeof augmentsByRarity)[]) {
    const stats = augmentsByRarity[rarity];
    const tierMap = computeTiers(stats.map((s) => ({ ...s, key: String(s.augmentId) })));
    stats.sort((a, b) => tierMap.get(String(b.augmentId))!.score - tierMap.get(String(a.augmentId))!.score);
    augmentsByRarity[rarity] = stats.slice(0, 5);
  }

  // Item build: for each build-order position, which items show up there most
  // often, most-frequent first. "excluded" items (Shardblade, Arcane Sweeper,
  // ...) are skipped — they're never a real build choice, so recommending
  // them would be noise.
  // Les 6 slots de build, alimentés différemment selon ce que la donnée permet
  // réellement de dire — voir BOOTS_SLOT et PRISMATIC_SLOT.
  const bySlot: Map<number, Accumulator>[] = Array.from({ length: BUILD_SLOT_COUNT }, () => new Map());
  for (const r of champRows) {
    // L'ordre d'achat quand on l'a, l'inventaire final sinon : un match dont le
    // timeline n'a pas encore été récupéré doit continuer à compter, avec la
    // précision d'avant, plutôt que de disparaître des stats.
    const source = r.item_order && r.item_order.length > 0 ? r.item_order : r.items;
    const usable = source.filter((id) => itemCategoryOf(id) !== "excluded");

    // Slot 1 — les bottes.
    const boots = usable.find((id) => itemCategoryOf(id) === "boots");
    if (boots !== undefined) accumulate(bySlot[BOOTS_SLOT - 1], boots, r.placement);

    // Slot 2 — les prismatiques, toujours depuis l'inventaire final puisqu'ils
    // sont absents du timeline. Chacun compte : un joueur qui en a deux
    // contribue deux fois, si bien que le slot fait ressortir le plus fréquent.
    for (const id of r.items) {
      if (itemCategoryOf(id) === "prismatic") accumulate(bySlot[PRISMATIC_SLOT - 1], id, r.placement);
    }

    // Slots 3+ — les légendaires, dans l'ordre d'achat réel quand il est connu.
    const legendaries = usable.filter(
      (id) => itemCategoryOf(id) !== "boots" && itemCategoryOf(id) !== "prismatic",
    );
    for (let i = 0; i < legendaries.length && PRISMATIC_SLOT + i < BUILD_SLOT_COUNT; i++) {
      accumulate(bySlot[PRISMATIC_SLOT + i], legendaries[i], r.placement);
    }
  }
  // Un item ne peut apparaître que dans UN seul slot, et les slots se servent
  // dans l'ordre du build.
  //
  // Sans cette règle, chaque slot choisissait ses trois items indépendamment des
  // autres — et comme un même légendaire est acheté en 1er par certains joueurs
  // et en 2e par d'autres, il ressortait en tête de plusieurs slots d'affilée.
  // Mesuré avant correction : les **173 champions** étaient concernés, avec par
  // exemple Death's Dance en tête des slots 3, 4, 5 et 6 chez Fiora.
  //
  // Le chiffre n'était pas faux — ces joueurs l'ont bien acheté à ces
  // positions-là — mais un build affiché quatre fois le même item se lit comme
  // un bug, pas comme une recommandation. On sert donc les slots de gauche à
  // droite en retirant ce qui a déjà été montré : le slot 3 prend ses trois
  // meilleurs, le slot 4 les trois meilleurs de ce qu'il reste, etc.
  //
  // Ne concerne en pratique que les slots légendaires : les bottes (slot 1) et
  // les prismatiques (slot 2) ont leurs propres catégories, exclues des autres.
  const itemBuild: ChampionItemSlot[] = [];
  const alreadyShown = new Set<number>();
  bySlot.forEach((slotMap, i) => {
    const items = Array.from(slotMap.entries())
      .filter(([itemId]) => !alreadyShown.has(itemId))
      .map(([itemId, s]) => ({ itemId, ...toStat(s, champGames) }))
      // Départage explicite des ex æquo. Sans lui, deux items à égalité de
      // parties étaient classés dans l'ordre où les lignes étaient arrivées de
      // la base — et comme chaque slot retire ce qu'il a pris, un ex æquo
      // tranché autrement au slot 3 change toute la suite du build. Mesuré :
      // 96 champions sur 173 voyaient leur build changer quand l'ordre de
      // lecture changeait, à chiffres pourtant identiques.
      .sort((a, b) => b.games - a.games || a.itemId - b.itemId)
      .slice(0, ALTS_PER_SLOT);
    if (items.length === 0) return;
    for (const item of items) alreadyShown.add(item.itemId);
    itemBuild.push({ slot: i + 1, items });
  });

  // Top 6 Prismatic items across this champion's games overall (any
  // playstyle) — sits under the item build slots.
  const topPrismaticItems = computeTopPrismaticItems(champRows, itemCategoryOf, champGames, 6);

  const anvilRows = champRows.filter((r) => isAnvilBuild(r.items, itemCategoryOf));
  const anvilAcc: Accumulator = { games: 0, top3Wins: 0, top1Wins: 0, placementSum: 0 };
  let anvilShardbladeCount = 0;
  for (const r of anvilRows) {
    anvilAcc.games += 1;
    anvilAcc.placementSum += r.placement;
    if (r.placement <= TOP3_PLACEMENT_THRESHOLD) anvilAcc.top3Wins += 1;
    if (r.placement === 1) anvilAcc.top1Wins += 1;
    if (r.items.includes(SHARDBLADE_ITEM_ID)) anvilShardbladeCount += 1;
  }
  const anvilShardbladeRate = anvilAcc.games > 0 ? anvilShardbladeCount / anvilAcc.games : 0;

  // Top 3 Prismatic items among just this champion's anvil-run games.
  const anvilTopPrismaticItems = computeTopPrismaticItems(anvilRows, itemCategoryOf, anvilAcc.games, 3);

  // Top 10 combos per category, scoped to this champion's own games — no
  // minimum games threshold (unlike the site-wide Combos page) since a
  // single champion's sample is already much smaller.
  const championCombos = computeCombos(champRows, itemCategoryOf, champGames, 1, 10);

  return {
    champion: champRows[0].champion,
    totalMatches,
    ...toStat(championAcc, totalMatches * PARTICIPANTS_PER_MATCH),
    augmentsByRarity,
    itemBuild,
    topPrismaticItems,
    anvilStat: toStat(anvilAcc, champGames),
    anvilShardbladeRate,
    anvilTopPrismaticItems,
    championCombos,
  };
}

// --- Augment timing -------------------------------------------------------

/**
 * How many of the augment slots are comparable across picks.
 *
 * `playerAugment1..6` arrive in pick order, so the array index *is* the pick
 * number — the one piece of round information Riot's match data gives us
 * (augment levels, which would answer "is this worth upgrading", are not
 * exposed at all: MATCH-V5 CHERRY returns bare ids, see developer-relations
 * issue #1157).
 *
 * Only the first three are usable for comparison. The baseline % Top 3 of
 * *every* pick made in each slot runs 50.0 / 50.0 / 52.5 / 61.9 / 72.4 / 78.8:
 * flat through slot 3, then steeply rising, because having a 4th/5th/6th
 * augment at all means you survived deep into the game or spent a crafting
 * round on a slot. Past slot 3 you'd be measuring survivorship, not timing.
 */
const TIMING_SLOTS = 3;

/** Picks required in *each* of the three slots before an augment is listed. */
const TIMING_MIN_PICKS = 30;

export type AugmentSlotStat = { slot: number; picks: number; top3Rate: number };

export type AugmentTimingStat = {
  augmentId: number;
  totalPicks: number;
  /** Exactly TIMING_SLOTS entries, slot 1 first. */
  slots: AugmentSlotStat[];
  /**
   * How much better this augment does as a 3rd pick than as a 1st, after
   * subtracting each slot's own baseline. Positive = hold it for later.
   */
  swing: number;
};

export type AugmentTimingStats = {
  totalMatches: number;
  /** % Top 3 across the eligible set's picks in each slot — what `swing` corrects for. */
  baselines: number[];
  augments: AugmentTimingStat[];
};

export async function getAugmentTimingStats(): Promise<AugmentTimingStats> {
  const rows = await fetchAllParticipants();
  const totalMatches = countMatches(rows);

  const perSlot: Map<number, Accumulator>[] = Array.from(
    { length: TIMING_SLOTS },
    () => new Map()
  );

  for (const row of rows) {
    row.augments.slice(0, TIMING_SLOTS).forEach((augmentId, index) => {
      accumulate(perSlot[index], augmentId, row.placement);
    });
  }

  const eligible = Array.from(perSlot[0].keys()).filter((id) =>
    perSlot.every((slot) => (slot.get(id)?.games ?? 0) >= TIMING_MIN_PICKS)
  );

  // Baselines come from the eligible set's own picks, not from every pick made
  // in that slot. An augment's swing is only ever read against the other 95 it
  // is ranked beside, so that's the population it has to be centred on — the
  // all-picks baseline is dragged around by the hundreds of rarely-taken
  // augments that never appear in this list. Measured on the current sample,
  // recentring moves the split from 43/96 positive to 47/96 and the median
  // swing from -0.9pp to -0.0pp, i.e. it removes the last of the drift.
  const baselines = perSlot.map((slot) => {
    let picks = 0;
    let top3 = 0;
    for (const id of eligible) {
      const acc = slot.get(id)!;
      picks += acc.games;
      top3 += acc.top3Wins;
    }
    return picks > 0 ? top3 / picks : 0;
  });

  const augments = eligible
    .map((augmentId) => {
      const slots = perSlot.map((slot, index) => {
        const acc = slot.get(augmentId)!;
        return { slot: index + 1, picks: acc.games, top3Rate: acc.top3Wins / acc.games };
      });
      const first = slots[0].top3Rate - baselines[0];
      const last = slots[TIMING_SLOTS - 1].top3Rate - baselines[TIMING_SLOTS - 1];
      return {
        augmentId,
        totalPicks: slots.reduce((sum, s) => sum + s.picks, 0),
        slots,
        swing: last - first,
      };
    })
    .sort((a, b) => b.swing - a.swing);

  return { totalMatches, baselines, augments };
}

// --- Team comps -----------------------------------------------------------

/**
 * A team's 3 champions, grouped one match-team at a time.
 *
 * Every match contributes 6 of these (6 teams of 3), and `placement` is a team
 * property, so unlike every other aggregation in this file the unit here is
 * the team, not the participant.
 */
type TeamRow = { champions: string[]; placement: number };

const TEAM_SIZE = 3;

function groupIntoTeams(rows: ParticipantRow[]): TeamRow[] {
  const byTeam = new Map<string, TeamRow>();
  for (const r of rows) {
    const key = `${r.match_id}:${r.subteam_id}`;
    const team = byTeam.get(key) ?? { champions: [], placement: r.placement };
    team.champions.push(r.champion);
    byTeam.set(key, team);
  }
  // A team missing members (a participant row that failed to save) would skew
  // archetype counts toward 2-champion shapes that can't exist in Three by Six.
  return Array.from(byTeam.values()).filter((t) => t.champions.length === TEAM_SIZE);
}

/**
 * What counts as "enough teams to say anything" about a specific champion
 * pairing. Only used to *report* how far off we are — see CompStats.coverage.
 */
const DUO_USABLE_TEAMS = 8;

/**
 * Minimum teams before an archetype is listed.
 *
 * Class trios are wildly uneven in how often they occur — Fighter·Mage·Marksman
 * turns up 237 times, Assassin·Tank·Tank a handful — because the classes
 * themselves are uneven (50 of 173 champions are Fighters). Without a floor the
 * rare shapes post absurd rates off 5-10 teams and, since tiering on this page
 * deliberately ignores volume, sail straight to S.
 */
const ARCHETYPE_MIN_TEAMS = 20;

export type ArchetypeStat = { roles: string[] } & Stat;

export type CompStats = {
  totalMatches: number;
  totalTeams: number;
  archetypes: ArchetypeStat[];
  /**
   * Why the only tier list on this page is by class.
   *
   * Neither exact trios nor specific champion duos can be ranked from the
   * current sample — 3.8k of 3.84k trios have been seen exactly once, and only
   * a handful of duos clear DUO_USABLE_TEAMS. Rather than ship a tier list
   * built on 5-game rows, the page states these counts and lets them grow.
   */
  coverage: {
    trios: { distinct: number; repeated: number };
    duos: { distinct: number; usable: number };
  };
};

export async function getCompStats(
  roleOf: (champion: string) => string | undefined
): Promise<CompStats> {
  const rows = await fetchAllParticipants();
  const totalMatches = countMatches(rows);
  const teams = groupIntoTeams(rows);
  const totalTeams = teams.length;

  const byArchetype = new Map<string, Accumulator>();
  const duoCounts = new Map<string, number>();
  const trioCounts = new Map<string, number>();

  for (const team of teams) {
    // Sorted so that Fighter/Mage/Support and Support/Fighter/Mage are one row:
    // Arena has no lanes or assigned positions, so a comp is a multiset of
    // three classes, not an ordered lineup.
    const roles = team.champions.map(roleOf);
    if (roles.every((r): r is string => r !== undefined)) {
      accumulate(byArchetype, [...roles].sort().join("|"), team.placement);
    }

    const champions = [...team.champions].sort();
    for (let i = 0; i < champions.length; i++) {
      for (let j = i + 1; j < champions.length; j++) {
        const duoKey = `${champions[i]}|${champions[j]}`;
        duoCounts.set(duoKey, (duoCounts.get(duoKey) ?? 0) + 1);
      }
    }

    const trioKey = champions.join("|");
    trioCounts.set(trioKey, (trioCounts.get(trioKey) ?? 0) + 1);
  }

  const archetypes = Array.from(byArchetype.entries())
    .filter(([, acc]) => acc.games >= ARCHETYPE_MIN_TEAMS)
    .map(([key, acc]) => ({ roles: key.split("|"), ...toStat(acc, totalTeams) }))
    .sort((a, b) => b.top3Rate - a.top3Rate);

  return {
    totalMatches,
    totalTeams,
    archetypes,
    coverage: {
      trios: {
        distinct: trioCounts.size,
        repeated: Array.from(trioCounts.values()).filter((n) => n > 1).length,
      },
      duos: {
        distinct: duoCounts.size,
        usable: Array.from(duoCounts.values()).filter((n) => n >= DUO_USABLE_TEAMS).length,
      },
    },
  };
}

// Below this: 2-element combos of items/augments picked by the same player
// in the same game — a lightweight "synergy" tier list. Boots and "excluded"
// items (Shardblade, Arcane Sweeper, ...) never take part in a combo.
const COMBO_MIN_GAMES = 5;
const COMBO_MAX_ROWS = 200;

export type ComboCategory = "item-item" | "augment-augment" | "item-augment";
type ComboPick = { type: "item" | "augment"; id: number };
export type ComboStat = { a: ComboPick; b: ComboPick } & Stat;

// Canonical order so a pair always accumulates under one key regardless of
// which of the two participant slots each half came from: items before
// augments, and lower id first within the same type.
function orderComboPick(x: ComboPick, y: ComboPick): [ComboPick, ComboPick] {
  if (x.type !== y.type) return x.type === "item" ? [x, y] : [y, x];
  return x.id <= y.id ? [x, y] : [y, x];
}

function comboCategory(a: ComboPick, b: ComboPick): ComboCategory {
  if (a.type === "item" && b.type === "item") return "item-item";
  if (a.type === "augment" && b.type === "augment") return "augment-augment";
  return "item-augment";
}

// Shared by the site-wide Combos tier list and the per-champion mini combo
// tables — only `rows`, the eligibility threshold, and the per-category cap
// differ between the two call sites.
function computeCombos(
  rows: ParticipantRow[],
  itemCategoryOf: ItemCategoryLookup,
  denominator: number,
  minGames: number,
  maxPerCategory: number
): Record<ComboCategory, ComboStat[]> {
  type ComboAcc = Accumulator & { a: ComboPick; b: ComboPick; category: ComboCategory };
  const combos = new Map<string, ComboAcc>();

  for (const r of rows) {
    const picks: ComboPick[] = [
      ...r.items
        .filter((id) => {
          const category = itemCategoryOf(id);
          return category !== "excluded" && category !== "boots";
        })
        .map((id) => ({ type: "item" as const, id })),
      ...r.augments.map((id) => ({ type: "augment" as const, id })),
    ];

    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        const [a, b] = orderComboPick(picks[i], picks[j]);
        const key = `${a.type}:${a.id}|${b.type}:${b.id}`;
        const entry = combos.get(key) ?? {
          a,
          b,
          category: comboCategory(a, b),
          games: 0,
          top3Wins: 0,
          top1Wins: 0,
          placementSum: 0,
        };
        entry.games += 1;
        entry.placementSum += r.placement;
        if (r.placement <= TOP3_PLACEMENT_THRESHOLD) entry.top3Wins += 1;
        if (r.placement === 1) entry.top1Wins += 1;
        combos.set(key, entry);
      }
    }
  }

  const byCategory: Record<ComboCategory, ComboStat[]> = {
    "item-item": [],
    "augment-augment": [],
    "item-augment": [],
  };
  for (const entry of combos.values()) {
    if (entry.games < minGames) continue;
    byCategory[entry.category].push({ a: entry.a, b: entry.b, ...toStat(entry, denominator) });
  }

  // Same tier score as everywhere else, used here purely to pick the best
  // combos per category — computeTiers is called again on just the ones kept
  // wherever they're displayed, so the S–D bands shown reflect the real gaps
  // in what's actually on screen, not the full unfiltered pool.
  for (const category of Object.keys(byCategory) as ComboCategory[]) {
    const keyed = byCategory[category].map((combo, i) => ({ ...combo, key: String(i) }));
    const tierMap = computeTiers(keyed);
    keyed.sort((x, y) => tierMap.get(y.key)!.score - tierMap.get(x.key)!.score);
    byCategory[category] = keyed.slice(0, maxPerCategory).map(({ key: _key, ...combo }) => combo);
  }

  return byCategory;
}

export async function getComboStats(
  itemCategoryOf: ItemCategoryLookup
): Promise<{ totalMatches: number; byCategory: Record<ComboCategory, ComboStat[]> }> {
  const rows = await fetchAllParticipants();
  const totalMatches = countMatches(rows);
  const denominator = totalMatches * PARTICIPANTS_PER_MATCH;
  const byCategory = computeCombos(rows, itemCategoryOf, denominator, COMBO_MIN_GAMES, COMBO_MAX_ROWS);
  return { totalMatches, byCategory };
}
