import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import { computeTiers } from "@/lib/tiers";
import { augmentCategory, canonicalItemId } from "@/lib/gameData";

export type ParticipantRow = {
  /** Sert aussi de curseur de pagination — voir readParticipantSet. */
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
  /** Tranche de niveau du joueur au moment du calcul : 1 = apex, 5 = bas de
   *  ladder, 0 = pas encore classé (moins de 5 parties suivies). Voir la vue
   *  `participants_clean`. Un smallint, pas le mu : on ne rapatrie pas un
   *  flottant par ligne sur 240 000 lignes pour en faire cinq paquets. */
  skill_bucket: number;
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

// Combien de lignes par requête de lecture.
//
// Le plafond par défaut de PostgREST est 1 000. Il a été relevé à 20 000 côté
// projet (`alter role authenticator set pgrst.db_max_rows`), parce que le coût
// d'une page est presque entièrement dans la MISE EN PLACE de la requête, pas
// dans le transfert : mesuré le 2026-09-15 sur la vue des participants, 1 000
// lignes coûtent 1,54 s et 10 000 lignes 1,28 s.
//
// Lire 116 000 participations faisait donc 116 requêtes séquentielles — 65 s,
// soit un tiers du job de publication. À 10 000 par page il en reste douze.
const PAGE_SIZE = 10000;

// Ce chemin ne sert plus une requête utilisateur : depuis 2026-09-13 les pages
// lisent des snapshots pré-calculés (lib/statsSnapshot.ts) et seul le job de
// rafraîchissement appelle les agrégateurs. Il n'a pas de pression de latence,
// d'où un plafond bien plus haut que les 30 pages d'avant (qui tronquaient dès
// ~1 660 matchs).
//
// 60 pages × 10 000 = 600 000 lignes ≈ 33 000 matchs, soit ~120 Mo en mémoire JS. Le
// plafond reste un garde-fou mémoire, pas une limite de conception : au-delà,
// l'agrégation doit passer en SQL (phase 3 du plan). La différence essentielle
// avec l'ancienne version est que la troncature n'est plus muette.
const MAX_PAGES = 60;

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
 * calculé dans Postgres (fonction `leaderboard_top`). Ce qui reste ici est ce
 * dont le calcul JS a vraiment besoin : **31 o par ligne, 3,5× moins**.
 */
/**
 * Colonnes demandées SOUS ALIAS D'UNE LETTRE, redéployées en JS à la lecture.
 *
 * PostgREST rend un tableau d'objets : le nom de chaque colonne est réécrit sur
 * CHAQUE ligne. `"skill_bucket":` seul, c'est 15 octets répétés 228 000 fois.
 *
 * Mesuré le 2026-09-16 sur une page de 10 000 lignes du patch courant, mêmes
 * données, même vue, même ordre :
 *
 *   noms complets   2 243 637 octets
 *   alias d'une lettre  1 613 637 octets   (-28 %)
 *
 * Exactement 63 octets par ligne, qui ne sont que des noms de colonnes. Sur la
 * lecture entière d'une publication, c'est une quinzaine de mégaoctets qui ne
 * traversent plus le réseau.
 *
 * Le nom lisible est rétabli dès la réception par `expandRow`, si bien
 * qu'aucun agrégateur ne voit jamais ces alias.
 */
const PARTICIPANT_COLUMNS =
  "b:match_id, c:subteam_id, d:champion, e:placement, f:augments, g:items, h:item_order, i:skill_bucket";

/** La ligne telle qu'elle arrive, sous alias. */
type CompactRow = {
  b: string;
  c: number;
  d: string;
  e: number;
  f: number[] | null;
  g: number[] | null;
  h: number[] | null;
  i: number | null;
};

/**
 * Ramène les formes évoluées à leur base (voir `canonicalItemId`), une fois
 * pour toutes, à l'entrée du domaine.
 *
 * Ici et pas dans chaque agrégateur : l'inventaire final est lu par la tier
 * list, les combos, les slots de build et les pages de champion, et un seul
 * oubli suffirait à faire coexister deux chiffres contradictoires pour le même
 * item. Après cette fonction, aucune forme évoluée ne circule plus.
 *
 * Rend le tableau reçu tel quel quand il n'y a rien à fusionner, c'est-à-dire
 * l'immense majorité des lignes — on en lit 230 000 par publication.
 */
function mergeEvolvedItems(ids: number[]): number[] {
  let i = 0;
  while (i < ids.length && canonicalItemId(ids[i]) === ids[i]) i += 1;
  if (i === ids.length) return ids;

  const merged = ids.slice(0, i);
  for (; i < ids.length; i += 1) {
    const canonical = canonicalItemId(ids[i]);
    // Les deux formes ne peuvent pas coexister dans un inventaire — la
    // transformation consomme la base — mais un doublon compterait l'item deux
    // fois, et ça coûte moins cher de l'empêcher que de le diagnostiquer.
    if (!merged.includes(canonical)) merged.push(canonical);
  }
  return merged;
}

function expandRow(row: CompactRow): ParticipantRow {
  return {
    match_id: row.b,
    subteam_id: row.c,
    champion: row.d,
    placement: row.e,
    augments: row.f ?? [],
    items: mergeEvolvedItems(row.g ?? []),
    // L'ordre d'achat ne contient déjà que des bases (la transformation n'est
    // pas un achat), mais le passer au même filtre rend l'invariant vrai des
    // deux tableaux, sans quoi il faudrait le rétablir plus loin au cas par cas.
    item_order: row.h && mergeEvolvedItems(row.h),
    skill_bucket: row.i ?? 0,
  };
}

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
 * La table matérialisée des deux patchs publiés.
 *
 * `participants_clean` est une vue à trois jointures : le patch vient de
 * `matches`, le `skill_bucket` de `player_ratings`, et l'exclusion des équipes
 * AFK est une anti-jointure. Une lecture complète les paie UNE fois — mesuré à
 * 34 000 buffers pour un patch entier. Mais la lecture est paginée : chacune des
 * 23 pages d'un patch refaisait les trois, soit 31 377 buffers × 23 ≈ 720 000.
 * Vingt fois le travail nécessaire, pour la même donnée.
 *
 * La vue matérialisée fige ce résultat. Une page redevient ce qu'elle aurait
 * toujours dû être — une plage d'index sur une table plate, sans jointure :
 * 7 666 buffers, un seul nœud dans le plan.
 *
 * Elle ne contient que les deux patchs publiés, choisis exactement comme
 * `patch_options` les choisit (voir lib/patches.ts). C'est ce qui la rend
 * durable : `match_participants` grossit sans fin, mais ce qu'on publie reste
 * deux patchs. Les patchs périmés ne coûtent plus rien à la lecture.
 *
 * Le prix est un rafraîchissement, ~19 s, en `concurrently` — donc sans verrou
 * pour les lecteurs. Il est déclenché par le job, juste avant de lire.
 */
const PUBLISHED_SOURCE = "participants_published";

/**
 * Remet la table matérialisée en phase avec la base.
 *
 * Lève en cas d'échec plutôt que de laisser lire des données figées : publier
 * en silence les chiffres d'il y a une heure serait pire qu'un job rouge.
 */
export async function refreshPublishedParticipants(): Promise<void> {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.rpc("refresh_published_participants");
  if (error) throw new Error(`Rafraîchissement de participants_published impossible : ${error.message}`);
}

/**
 * Fetches one page. Split out from fetchAllParticipants so pages can be
 * requested with Promise.all instead of a sequential loop — at ~13k rows/14
 * pages, one-at-a-time round trips added up to several seconds per page load
 * and occasionally tipped over the platform's request timeout.
 *
 * ⚠️ Le tri n'est PAS cosmétique. Un `.range()` sans tri laisse Postgres libre
 * de renvoyer les lignes dans l'ordre qu'il veut : des pages se recouvrent,
 * d'autres lignes ne sont jamais lues. Le défaut existait déjà sur la table
 * brute, où l'ordre du disque le masquait ; le passage à une vue avec jointure
 * l'a révélé immédiatement — 2 051 matchs agrégés au lieu de 2 087, et des
 * chiffres faux sur 172 champions sur 173.
 *
 * ─── POURQUOI LE CURSEUR EST `match_id` ET NON `id` ──────────────────────────
 *
 * Trier par `id` paraissait naturel : c'est la clé primaire. Mais le patch, lui,
 * vit dans `matches`. Postgres n'a donc aucun index qui donne « les lignes de ce
 * patch, dans l'ordre des id » — il doit lire tout le reste de la table depuis
 * le curseur, jeter les autres patchs, puis TRIER le reste pour en prendre
 * 10 000. Le `limit` ne s'arrête plus tôt : le tri doit d'abord tout consommer.
 * Le coût d'une page suit alors la taille de la table, et la lecture entière
 * devient quadratique.
 *
 * Invisible tant que la base était petite. À 800 000 lignes, une page dépassait
 * le délai maximum d'une requête et la publication échouait (17/09, 13h35).
 *
 * Trier par `match_id` change la nature du plan. L'index (patch, match_id) sur
 * `matches` donne directement les matchs du patch dans l'ordre, et chacun tire
 * ses 18 participants par la clé (match_id, player_id). Postgres s'arrête dès
 * qu'il a ses 10 000 lignes : une page ne coûte plus que ce qu'elle rend, quelle
 * que soit la taille de la base. Mesuré à profondeur et cache égaux sur le patch
 * 16.17 : 3 693 ms et 136 063 buffers par `id`, 85 ms et 31 377 buffers par
 * `match_id`.
 *
 * `player_id` est le tri secondaire, côté serveur seulement : il rend l'ordre
 * des lignes d'un même match reproductible d'une lecture à l'autre. C'était
 * `id`, une colonne bigint que la compression du 2026-09-22 a supprimée — son
 * index coûtait 42 Mo pour zéro lecture, et (match_id, player_id) est
 * désormais la clé primaire, donc cet ordre est celui d'un index qui existe.
 */
function fetchParticipantPage(afterMatchId: string | null, patch: string | null, source: string) {
  if (!supabaseAdmin) return Promise.resolve<ParticipantRow[]>([]);
  let query = supabaseAdmin
    .from(source)
    .select(PARTICIPANT_COLUMNS)
    .order("match_id", { ascending: true })
    .order("player_id", { ascending: true })
    .limit(PAGE_SIZE);
  if (afterMatchId !== null) query = query.gt("match_id", afterMatchId);
  // Le filtre part en SQL : on ne lit que les lignes du patch demandé au lieu
  // de tout charger pour trier ensuite. Découper par patch coûte donc moins
  // d'egress qu'avant, pas plus. `patch` n'est jamais dans les colonnes
  // sélectionnées — filtrer dessus n'oblige pas à le transporter.
  if (patch) query = query.eq("patch", patch);
  return query.then(({ data, error }) => {
    if (error) throw error;
    return ((data ?? []) as unknown as CompactRow[]).map(expandRow);
  });
}

export type ParticipantSet = {
  rows: ParticipantRow[];
  /** Nombre de lignes réellement présentes en base, avant plafonnement. */
  totalRows: number;
  /** true si MAX_PAGES a coupé la lecture : les stats calculées là-dessus sont
   * partielles. Signalé explicitement pour ne plus jamais être silencieux. */
  truncated: boolean;
  /**
   * Le patch que ce jeu couvre, ou `null` pour « tout l'historique ».
   *
   * Porté par le contexte parce que les agrégations qui migrent vers SQL en ont
   * besoin : elles ne reçoivent pas les lignes, elles reçoivent la question.
   * Sans ça il faudrait ajouter un paramètre de patch aux douze signatures
   * d'agrégateurs, et le faire traverser toutes les fonctions intermédiaires —
   * exactement ce que ce contexte existe pour éviter.
   */
  patch: string | null;
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

/**
 * Toutes les pages d'une source, du début à la fin.
 *
 * Pagination PAR CLÉ, et non par offset. `.range(60000, 60999)` oblige Postgres
 * à parcourir puis jeter les 60 000 lignes précédentes — le coût d'une page
 * croît avec sa profondeur. Mesuré au 2026-09-15 sur 65 000 lignes : 1,42 s
 * pour la page 60 en offset contre 0,21 s par clé, et constant. Et comme ces
 * pages partaient toutes EN PARALLÈLE, la base recevait 65 parcours complets
 * d'un coup : le job de publication dépassait le délai maximum et le site ne se
 * mettait plus à jour.
 *
 * Par clé, chaque page est un parcours d'index borné. La lecture redevient
 * séquentielle — on a besoin du dernier match pour demander le suivant — mais
 * chaque requête est si courte que le total est plus rapide qu'en parallèle,
 * sans saturer la base.
 */
async function readAllPages(
  source: string,
  patch: string | null,
): Promise<{ rows: ParticipantRow[]; truncated: boolean }> {
  const rows: ParticipantRow[] = [];
  let afterMatchId: string | null = null;
  let pages = 0;
  for (; pages < MAX_PAGES; pages++) {
    const page = await fetchParticipantPage(afterMatchId, patch, source);
    if (page.length < PAGE_SIZE) {
      rows.push(...page);
      break;
    }

    // Le `limit` tombe au milieu d'un match : ses 18 lignes sont à cheval sur
    // deux pages. Comme le curseur est le match_id, demander « après ce match »
    // ferait disparaître la moitié restée de l'autre côté. On coupe donc la
    // page au dernier match COMPLET et on laisse le match entamé à la page
    // suivante, qui le relira en entier. Au plus 17 lignes relues par page.
    const lastMatchId = page[page.length - 1].match_id;
    let cut = page.length;
    while (cut > 0 && page[cut - 1].match_id === lastMatchId) cut -= 1;

    // Une page entière sur un seul match voudrait dire 10 000 participants pour
    // une partie : impossible (18), mais avancer quand même évite une boucle
    // infinie si la donnée devenait absurde.
    if (cut === 0) {
      rows.push(...page);
      afterMatchId = lastMatchId;
      continue;
    }

    rows.push(...page.slice(0, cut));
    afterMatchId = page[cut - 1].match_id;
  }
  return { rows, truncated: pages >= MAX_PAGES };
}

const readParticipantSet = cache(async function readParticipantSet(
  patch: string | null,
): Promise<ParticipantSet> {
  if (!supabaseAdmin) return { rows: [], totalRows: 0, truncated: false, patch };

  // Sans patch, la vue : la table matérialisée ne connaît que les deux patchs
  // publiés, elle répondrait à côté de la question.
  let read = await readAllPages(patch ? PUBLISHED_SOURCE : PARTICIPANT_SOURCE, patch);

  // Le seul moment où la table matérialisée peut ignorer un patch légitime :
  // celui où un nouveau patch vient d'entrer dans les deux publiés et où le job
  // n'a pas encore rafraîchi. Une page afficherait alors des tier lists vides,
  // et Next.js les garderait en cache une demi-heure. Le repli sur la vue coûte
  // une lecture lente une fois tous les quinze jours ; une page vide coûte plus.
  if (patch && read.rows.length === 0) {
    console.warn(
      `[aggregate] patch "${patch}" absent de ${PUBLISHED_SOURCE} — repli sur ${PARTICIPANT_SOURCE}. ` +
        `Attendu juste après un changement de patch, anormal sinon.`,
    );
    read = await readAllPages(PARTICIPANT_SOURCE, patch);
  }

  if (read.truncated) {
    console.error(
      `[aggregate] TRONCATURE : lecture arrêtée à ${MAX_PAGES * PAGE_SIZE} lignes. ` +
        `Les stats calculées sont partielles — il faut passer l'agrégation en SQL (phase 3 du plan).`,
    );
  }

  // `totalRows` vaut ce qu'on a lu : le comptage exact qui le fournissait
  // coûtait jusqu'à 8 s sur la vue (anti-jointure AFK sur chaque ligne) pour
  // une information que la lecture donne gratuitement.
  return {
    rows: dropExcludedAugments(read.rows),
    totalRows: read.rows.length,
    truncated: read.truncated,
    patch,
  };
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
 * Dérivés d'un jeu de lignes, calculés une seule fois pour tous ses lecteurs.
 *
 * Trois calculs traversaient l'échantillon ENTIER une fois par champion, soit
 * 346 fois par patch : le comptage des matchs, le filtre `champion`, et les
 * références de jalon. Mesuré au 2026-09-15 sur 96 000 lignes, l'agrégation
 * passait 76 s dont l'essentiel là-dedans, pour recalculer 346 fois trois
 * résultats strictement identiques.
 *
 * Le cache est une `WeakMap` sur le tableau de lignes lui-même : deux jeux
 * différents (un patch, un sous-ensemble anvil) ne partagent rien, et rien ne
 * survit au jeu qui l'a produit.
 */
type DerivedSet = {
  matchCount?: number;
  byChampion?: Map<string, ParticipantRow[]>;
  /** Par fonction de catégorie : une catégorisation différente donne des
   *  références différentes, et rien ne garantit qu'il n'y en ait qu'une. */
  baselines: Map<ItemCategoryLookup, LandmarkBaselines>;
};

const derivedStore = new WeakMap<ParticipantRow[], DerivedSet>();

function derivedOf(rows: ParticipantRow[]): DerivedSet {
  let derived = derivedStore.get(rows);
  if (!derived) {
    derived = { baselines: new Map() };
    derivedStore.set(rows, derived);
  }
  return derived;
}

function matchCountOf(rows: ParticipantRow[]): number {
  const derived = derivedOf(rows);
  derived.matchCount ??= countMatches(rows);
  return derived.matchCount;
}

/** Les lignes regroupées par champion, clé en minuscules. */
function championRowsOf(rows: ParticipantRow[]): Map<string, ParticipantRow[]> {
  const derived = derivedOf(rows);
  if (!derived.byChampion) {
    const index = new Map<string, ParticipantRow[]>();
    for (const row of rows) {
      const key = row.champion.toLowerCase();
      const bucket = index.get(key);
      if (bucket) bucket.push(row);
      else index.set(key, [row]);
    }
    derived.byChampion = index;
  }
  return derived.byChampion;
}

function landmarkBaselinesOf(
  rows: ParticipantRow[],
  categoryOf: ItemCategoryLookup,
): LandmarkBaselines {
  const derived = derivedOf(rows);
  let baselines = derived.baselines.get(categoryOf);
  if (!baselines) {
    baselines = buildLandmarkBaselines(rows, categoryOf);
    derived.baselines.set(categoryOf, baselines);
  }
  return baselines;
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
export function toStat(s: Accumulator, denominator: number): Stat {
  return {
    games: s.games,
    top3Rate: s.games > 0 ? s.top3Wins / s.games : 0,
    top1Rate: s.games > 0 ? s.top1Wins / s.games : 0,
    avgPlacement: s.games > 0 ? s.placementSum / s.games : 0,
    playRate: denominator > 0 ? s.games / denominator : 0,
  };
}

/**
 * ─── LES LISTES LONGUES VOYAGENT EN COMPTEURS, PAS EN TAUX ───────────────────
 *
 * Les onglets d'une page de champion publient des listes entières : ~115
 * augments et ~79 items par champion et par patch, contre 5 et 6 avant. Écrits
 * comme le reste du site, en objets nommés à taux flottants, ils pèseraient
 * 21 Mo de snapshots là où le job en écrit 5,6 aujourd'hui.
 *
 * L'essentiel de ce poids ne porte aucune information. `"top3Rate":
 * 0.5121951219512195` occupe 30 caractères pour une valeur affichée à deux
 * décimales — et ce n'est même pas la donnée d'origine, seulement un quotient.
 *
 * On transporte donc le NUMÉRATEUR : quatre entiers dont les quatre taux se
 * redéduisent exactement, par le même `toStat` que partout ailleurs. La ligne
 * passe de ~165 octets à ~25, et gagne en précision au passage puisque plus
 * rien n'est arrondi en route.
 *
 * Réservé aux listes longues. Les payloads courts restent en objets nommés :
 * un tableau positionnel se lit mal, et l'économie n'y vaut pas la relecture.
 */
export type PackedStat = [
  id: number,
  games: number,
  top1: number,
  top3: number,
  placementSum: number,
];

function packStat(id: number, a: Accumulator): PackedStat {
  return [id, a.games, a.top1Wins, a.top3Wins, a.placementSum];
}

export function unpackStat(packed: PackedStat, denominator: number): { id: number } & Stat {
  const [id, games, top1Wins, top3Wins, placementSum] = packed;
  return { id, ...toStat({ games, top1Wins, top3Wins, placementSum }, denominator) };
}

/** Idem, plus les trois métriques corrigées du jalon, qui elles ne se déduisent
 *  de rien (voir adjustedItemStats). Arrondies au dix-millième : elles ne
 *  servent qu'à ordonner des tiers, jamais à être affichées. */
export type PackedItemStat = [
  ...PackedStat,
  tierAvgPlacement: number,
  tierTop3Rate: number,
  tierTop1Rate: number,
];

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function unpackItemStat(
  packed: PackedItemStat,
  denominator: number,
): { itemId: number } & Stat & { tierStat: { avgPlacement: number; top3Rate: number; top1Rate: number } } {
  const [id, games, top1Wins, top3Wins, placementSum, tierAvg, tierTop3, tierTop1] = packed;
  return {
    itemId: id,
    ...toStat({ games, top1Wins, top3Wins, placementSum }, denominator),
    tierStat: { avgPlacement: tierAvg, top3Rate: tierTop3, top1Rate: tierTop1 },
  };
}

/** Une paire, ses deux choix encodés comme dans computeCombos (voir pickCode). */
export type PackedCombo = [
  a: number,
  b: number,
  games: number,
  top1: number,
  top3: number,
  placementSum: number,
];

export function unpackCombo(packed: PackedCombo, denominator: number): ComboStat {
  const [a, b, games, top1Wins, top3Wins, placementSum] = packed;
  return {
    a: decodePick(a),
    b: decodePick(b),
    ...toStat({ games, top1Wins, top3Wins, placementSum }, denominator),
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

/**
 * ─── SQL REGROUPE, LE JS NOTE ────────────────────────────────────────────────
 *
 * Première agrégation descendue en base (2026-09-24). Le principe vaut pour
 * toutes celles qui suivront.
 *
 * Ce qui descend, c'est la RÉDUCTION : passer de 401 082 participations à 173
 * compteurs. Mesuré, cette réduction coûte 311 ms en SQL, là où transporter les
 * mêmes lignes à travers PostgREST en coûtait une bonne vingtaine de secondes —
 * sur les 51 s que la lecture pesait dans le job.
 *
 * Ce qui RESTE en JavaScript, c'est tout ce qui a demandé de la mesure : la
 * correction de biais par jalon, le rétrécissement vers la moyenne, les k-means
 * des tiers. Les réécrire en SQL risquerait des chiffres faux pour un gain nul,
 * puisqu'une fois l'échantillon réduit à 173 lignes le calcul ne coûte plus
 * rien. Le contrat est donc : la base rend des compteurs bruts, `toStat` reste
 * le seul endroit du site où un taux se calcule.
 *
 * Le repli sur le chemin JS n'est pas une précaution de style : sans patch —
 * une lecture « tout l'historique » — il n'y a pas de vue publiée à interroger,
 * et c'est aussi le chemin qu'emprunte une page quand un patch vient d'entrer
 * dans la fenêtre et que le job n'a pas encore republié.
 */
export async function getChampionStats() {
  const set = await fetchParticipantSet();
  if (set.patch && supabaseAdmin) {
    const [{ data, error }, { data: matchCount, error: countError }] = await Promise.all([
      supabaseAdmin.rpc("champion_stats", { target_patch: set.patch }),
      supabaseAdmin.rpc("patch_match_count", { target_patch: set.patch }),
    ]);
    if (error) throw error;
    if (countError) throw countError;

    const totalMatches = Number(matchCount ?? 0);
    const champions = ((data ?? []) as ChampionStatsRow[])
      .map((r) => ({
        champion: r.champion,
        ...toStat(
          {
            games: Number(r.games),
            top3Wins: Number(r.top3_wins),
            top1Wins: Number(r.top1_wins),
            placementSum: Number(r.placement_sum),
          },
          totalMatches * PARTICIPANTS_PER_MATCH,
        ),
      }))
      .sort((a, b) => b.top3Rate - a.top3Rate);
    return { totalMatches, champions };
  }

  const rows = set.rows;
  const totalMatches = matchCountOf(rows);
  const byChampion = new Map<string, Accumulator>();
  for (const r of rows) accumulate(byChampion, r.champion, r.placement);
  const champions = Array.from(byChampion.entries())
    .map(([champion, s]) => ({ champion, ...toStat(s, totalMatches * PARTICIPANTS_PER_MATCH) }))
    .sort((a, b) => b.top3Rate - a.top3Rate);
  return { totalMatches, champions };
}

/** Ce que `champion_stats` rend : des compteurs, jamais des taux. */
type ChampionStatsRow = {
  champion: string;
  games: number;
  top1_wins: number;
  top3_wins: number;
  placement_sum: number;
};

/**
 * Les quatre augments « stat anvil » du pool courant, dans leur ordre de
 * rareté : Stats! (silver), Stats on Stats! (gold), Stats on Stats on Stats!
 * (prismatic), Gamba Anvil (prismatic).
 *
 * Ce sont les seuls augments qui donnent des enclumes de stats, donc les seuls
 * dont la présence en PREMIER pick annonce vraiment une partie sans boutique.
 * Vérifié en base : les autres identifiants qui portent ces noms (1402-1404,
 * ainsi que « Gain Stat Anvil » 340/355) n'apparaissent en premier pick sur
 * aucune partie suivie — ils ne sont plus dans le pool.
 */
export const ANVIL_OPENER_AUGMENTS = [226, 227, 228, 234] as const;

const ANVIL_OPENER_SET = new Set<number>(ANVIL_OPENER_AUGMENTS);

/**
 * Parties requises avant qu'un champion entre dans une tier list filtrée.
 *
 * Bien plus haut que les seuils voisins (5 pour les listes de champion, 3 pour
 * l'onglet enclume) parce que le lot est bien plus mince : filtrer sur un
 * premier augment ne garde que 3 000 à 5 500 parties pour ~173 champions, et le
 * mieux fourni d'entre eux plafonne à 35 sur un patch.
 *
 * À 10 parties l'erreur type du placement moyen vaut encore ~0,5 — c'est dit
 * sur la page, et c'est pourquoi le bandeau de comparaison, lui, porte le
 * message : il s'appuie sur le lot entier, pas sur une case.
 *
 * Descendre à 5 doublerait le nombre de lignes affichées sans ajouter une
 * seule information : on montrerait du bruit avec un rang devant.
 */
const ANVIL_OPENER_MIN_GAMES = 10;

/** Ce qu'a donné un lot de parties, sans `playRate` : la part n'a pas de sens
 *  pour une ouverture, qui se compare à elle-même d'un style de jeu à l'autre. */
export type AnvilOutcome = Omit<Stat, "playRate">;

/** Les deux moitiés d'un champion : anvil runs ouverts sur un augment
 *  d'enclume, et tous les autres. */
export type ChampionAnvilOpening = { statAnvil: AnvilOutcome; other: AnvilOutcome };

export type AnvilOpenerStats = {
  augmentId: number;
  /** Les parties ouvertes par cet augment qui SONT parties en enclumes. */
  anvil: AnvilOutcome;
  /**
   * Les parties ouvertes par cet augment où le joueur a quand même acheté.
   *
   * C'est la moitié de la comparaison qui manquait : sans elle, la page
   * laisserait croire que ces augments rendent l'anvil run meilleur, alors
   * qu'ils rendent la PARTIE meilleure. Mesuré sur 16.17+16.18, le placement
   * moyen est même un peu MEILLEUR en achetant (3,11 contre 3,20 sur Gamba
   * Anvil) — c'est le Top 1 qui bascule dans l'autre sens (29,6 % contre
   * 23,4 %). L'enclume est un pari, pas un raccourci.
   */
  bought: AnvilOutcome;
  /** Stats par champion sur les anvil runs ouverts par cet augment, au-dessus
   *  de ANVIL_OPENER_MIN_GAMES. `playRate` se rapporte ici aux anvil runs du
   *  champion, pas à ses parties totales. */
  champions: ({ champion: string } & Stat)[];
};

const EMPTY_ACCUMULATOR: Accumulator = { games: 0, top3Wins: 0, top1Wins: 0, placementSum: 0 };

function outcomeOf(s: Accumulator | undefined): AnvilOutcome {
  const stat = toStat(s ?? EMPTY_ACCUMULATOR, 0);
  return {
    games: stat.games,
    top3Rate: stat.top3Rate,
    top1Rate: stat.top1Rate,
    avgPlacement: stat.avgPlacement,
  };
}

// Same shape as getChampionStats, scoped to participants playing an "anvil
// run" (see isAnvilBuild below) — powers the dedicated Anvil Run tier list.
// playRate here is "% of this champion's own games (any playstyle) that were
// an anvil run" rather than a pick rate over the anvil population — matching
// the anvilStat.playRate shown on the champion detail page.
/** Ce que les quatre fonctions `anvil_*` rendent : des compteurs, jamais des taux. */
type AnvilChampionRow = {
  champion: string;
  games: number;
  top1_wins: number;
  top3_wins: number;
  placement_sum: number;
  total_games: number;
};
type AnvilOverallRow = {
  total_matches: number;
  games: number;
  top1_wins: number;
  top3_wins: number;
  placement_sum: number;
};
type AnvilOpenerRow = {
  augment_id: number;
  anvil_games: number;
  anvil_top1: number;
  anvil_top3: number;
  anvil_placement_sum: number;
  bought_games: number;
  bought_top1: number;
  bought_top3: number;
  bought_placement_sum: number;
};
type AnvilOpenerChampionRow = {
  augment_id: number;
  champion: string;
  games: number;
  top1_wins: number;
  top3_wins: number;
  placement_sum: number;
};

const acc = (games: number, top1: number, top3: number, sum: number): Accumulator => ({
  games: Number(games),
  top1Wins: Number(top1),
  top3Wins: Number(top3),
  placementSum: Number(sum),
});

/**
 * Quatrième agrégation descendue en base.
 *
 * Le test « cette partie est-elle un anvil run » s'écrit en SQL
 * `items <@ libres` — l'inventaire est contenu dans l'ensemble des items
 * gratuits (prismatiques et exclus). Une seule opération de tableau par ligne.
 *
 * Les deux cas limites tombent juste, et c'est ce qui rend l'écriture
 * utilisable : un inventaire VIDE est contenu dans n'importe quoi donc compte
 * comme anvil, exactement ce que `items.every(...)` rend ici ; et un item
 * inconnu de `ref_items` n'est pas dans l'ensemble, donc il disqualifie, comme
 * `categoryOf(id)` qui rend `undefined`.
 *
 * Quatre requêtes là où le JS fait une passe, parce que les quatre résultats
 * ont quatre formes différentes. Elles partent ensemble.
 */
export async function getAnvilChampionStats(itemCategoryOf: ItemCategoryLookup) {
  const set = await fetchParticipantSet();
  if (set.patch && supabaseAdmin) {
    const openerIds = [...ANVIL_OPENER_AUGMENTS];
    const [champRes, overallRes, openerRes, openerChampRes] = await Promise.all([
      supabaseAdmin.rpc("anvil_champions", { target_patch: set.patch }),
      supabaseAdmin.rpc("anvil_overall", { target_patch: set.patch }),
      supabaseAdmin.rpc("anvil_openers", { target_patch: set.patch, opener_ids: openerIds }),
      supabaseAdmin.rpc("anvil_opener_champions", {
        target_patch: set.patch,
        opener_ids: openerIds,
        min_games: ANVIL_OPENER_MIN_GAMES,
      }),
    ]);
    for (const r of [champRes, overallRes, openerRes, openerChampRes]) {
      if (r.error) throw r.error;
    }

    const champRows = (champRes.data ?? []) as AnvilChampionRow[];
    const over = ((overallRes.data ?? []) as AnvilOverallRow[])[0];

    const champions = champRows
      .map((r) => ({
        champion: r.champion,
        ...toStat(
          acc(r.games, r.top1_wins, r.top3_wins, r.placement_sum),
          Number(r.total_games),
        ),
      }))
      .sort((a, b) => b.top3Rate - a.top3Rate);

    // Dénominateur des colonnes par ouvreur : les anvil runs DE CE CHAMPION.
    const anvilGamesOf = new Map(champRows.map((r) => [r.champion, Number(r.games)]));
    const openerRows = (openerRes.data ?? []) as AnvilOpenerRow[];
    const openerChampRows = (openerChampRes.data ?? []) as AnvilOpenerChampionRow[];

    const openers: AnvilOpenerStats[] = ANVIL_OPENER_AUGMENTS.map((augmentId) => {
      const o = openerRows.find((r) => Number(r.augment_id) === augmentId);
      return {
        augmentId,
        anvil: outcomeOf(
          o && acc(o.anvil_games, o.anvil_top1, o.anvil_top3, o.anvil_placement_sum),
        ),
        bought: outcomeOf(
          o && acc(o.bought_games, o.bought_top1, o.bought_top3, o.bought_placement_sum),
        ),
        champions: openerChampRows
          .filter((r) => Number(r.augment_id) === augmentId)
          .map((r) => ({
            champion: r.champion,
            ...toStat(
              acc(r.games, r.top1_wins, r.top3_wins, r.placement_sum),
              anvilGamesOf.get(r.champion) ?? 0,
            ),
          }))
          // Le placement moyen mène, comme partout ailleurs sur le site.
          .sort((a, b) => a.avgPlacement - b.avgPlacement),
      };
    });

    return {
      totalMatches: Number(over?.total_matches ?? 0),
      overall: outcomeOf(
        over && acc(over.games, over.top1_wins, over.top3_wins, over.placement_sum),
      ),
      champions,
      openers,
    };
  }

  const rows = set.rows;

  // UNE passe sur les lignes, pas deux.
  //
  // `isAnvilBuild` parcourt l'inventaire de chaque ligne, et les ouvertures
  // ci-dessous ont besoin exactement du même verdict pour trancher entre
  // « parti en enclumes » et « a acheté ». Le recalculer dans une seconde
  // boucle ferait deux fois le travail sur 300 000 lignes pour obtenir deux
  // fois la même réponse.
  const totalGamesByChampion = new Map<string, number>();
  const anvilRows: ParticipantRow[] = [];
  const openerAnvil = new Map<number, Accumulator>();
  const openerBought = new Map<number, Accumulator>();
  const openerByChampion = new Map<number, Map<string, Accumulator>>();

  for (const r of rows) {
    totalGamesByChampion.set(r.champion, (totalGamesByChampion.get(r.champion) ?? 0) + 1);
    const anvil = isAnvilBuild(r.items, itemCategoryOf);
    if (anvil) anvilRows.push(r);

    // `augments[0]` EST le premier pick : les `playerAugment1..6` de Riot
    // arrivent dans l'ordre où ils ont été choisis (voir TIMING_SLOTS).
    const opener = r.augments[0];
    if (opener === undefined || !ANVIL_OPENER_SET.has(opener)) continue;
    accumulate(anvil ? openerAnvil : openerBought, opener, r.placement);
    if (!anvil) continue;
    let byChamp = openerByChampion.get(opener);
    if (!byChamp) openerByChampion.set(opener, (byChamp = new Map()));
    accumulate(byChamp, r.champion, r.placement);
  }

  const totalMatches = countMatches(anvilRows);
  const byChampion = new Map<string, Accumulator>();
  // Le point zéro du bandeau de comparaison. Accumulé ici plutôt que
  // reconstitué en sommant `champions` : une moyenne de moyennes pondérée se
  // recalcule juste, mais elle se recalcule FAUX au premier oubli du poids.
  const overall = new Map<string, Accumulator>();
  for (const r of anvilRows) {
    accumulate(byChampion, r.champion, r.placement);
    accumulate(overall, "all", r.placement);
  }
  const champions = Array.from(byChampion.entries())
    .map(([champion, s]) => ({
      champion,
      ...toStat(s, totalGamesByChampion.get(champion) ?? 0),
    }))
    .sort((a, b) => b.top3Rate - a.top3Rate);

  const openers: AnvilOpenerStats[] = ANVIL_OPENER_AUGMENTS.map((augmentId) => ({
    augmentId,
    anvil: outcomeOf(openerAnvil.get(augmentId)),
    bought: outcomeOf(openerBought.get(augmentId)),
    champions: Array.from(openerByChampion.get(augmentId) ?? [])
      .filter(([, s]) => s.games >= ANVIL_OPENER_MIN_GAMES)
      // Dénominateur : les anvil runs DE CE CHAMPION. Sous filtre, la colonne
      // répond « sur ses parties d'enclume, combien ont commencé par cet
      // augment » — une part lisible, là où la rapporter à ses parties totales
      // donnait des dixièmes de pour cent.
      .map(([champion, s]) => ({
        champion,
        ...toStat(s, byChampion.get(champion)?.games ?? 0),
      }))
      // Le placement moyen mène, comme partout ailleurs sur le site. Le tableau
      // retrie par tier à l'affichage ; cet ordre est celui du repli.
      .sort((a, b) => a.avgPlacement - b.avgPlacement),
  }));

  return { totalMatches, overall: outcomeOf(overall.get("all")), champions, openers };
}

// "excluded" items (quest-only rewards like Shardblade, or auto-granted ones
// like Arcane Sweeper) are never a real shop choice — so they're excluded
// from item stats/recommendations wherever this is passed.
type ItemCategoryLookup = (itemId: number) => "boots" | "prismatic" | "excluded" | undefined;

// Shared with the champion page, which needs the id to resolve the icon for
// the "% of anvil games that got a Shardblade" stat.
export const SHARDBLADE_ITEM_ID = 220012;

/**
 * ─── DEUX BIAIS DU CLASSEMENT D'ITEMS ────────────────────────────────────────
 *
 * 1. LA SURVIE. Un item n'arrive dans un build que si la partie a duré. Les
 *    items tardifs héritent donc du placement des équipes qui ont survécu, sans
 *    y être pour rien : le placement moyen passe de 3,90 à 3 items achetés à
 *    2,48 à 6.
 *
 * 2. LE NIVEAU DES ACHETEURS. Mesuré ensuite : les items achetés tard le sont
 *    par les MEILLEURS joueurs (corrélation 0,556 entre créneau et MMR moyen
 *    des acheteurs), et ces joueurs placent mieux quoi qu'ils achètent
 *    (corrélation -0,720 entre ce MMR et la note de l'item).
 *
 * Le correctif est le même dans les deux cas — l'ANALYSE PAR JALON, correctif
 * standard de l'immortal time bias en épidémiologie : on ne compare que des
 * sujets comparables. Ici le jalon a deux dimensions, « où en était le build »
 * et « quel niveau avait le joueur ».
 *
 * Où en était le build se lit différemment selon la provenance de l'item :
 *
 *   - ACHETÉ : le rang de l'achat, depuis l'ordre reconstitué de la timeline.
 *   - PRISMATIQUE : 94 % ne sont jamais achetés, ils viennent des enclumes et
 *     des augments. Leur jalon est le NOMBRE de prismatiques obtenus, qui suit
 *     la même horloge (les enclumes tombent à des manches fixes).
 *
 * ─── CE QUE LA CORRECTION TOUCHE, ET CE QU'ELLE NE TOUCHE PAS ────────────────
 *
 * Les colonnes affichées restent BRUTES. Un joueur qui a eu cet item a
 * réellement fini 2,70 de moyenne ; afficher 2,99 sous l'étiquette « Avg
 * Placement » serait mentir sur un fait vérifiable. Et si la moyenne affichée
 * et le tier sortaient du même chiffre corrigé, les deux tris donneraient le
 * même ordre : on perdrait une information en croyant en gagner une.
 *
 * Seul le TIER porte la correction. C'est son rôle — il est là pour juger, les
 * colonnes sont là pour constater. Conséquence assumée : un item S peut
 * afficher une moyenne moins bonne qu'un item A, et c'est précisément
 * l'information utile.
 */

/** En dessous, la case (jalon × niveau) est trop mince pour servir de
 *  référence : on retombe alors sur le jalon seul, moins précis mais solide. */
const LANDMARK_MIN_CELL = 40;

type LandmarkKind = "prismatic" | "bought";
type Metrics = { placement: number; top3: number; top1: number };
type MetricSum = Metrics & { n: number };

const emptySum = (): MetricSum => ({ n: 0, placement: 0, top3: 0, top1: 0 });

function addMetrics(sum: MetricSum, placement: number) {
  sum.n += 1;
  sum.placement += placement;
  sum.top3 += placement <= TOP3_PLACEMENT_THRESHOLD ? 1 : 0;
  sum.top1 += placement === 1 ? 1 : 0;
}

const meanOf = (sum: MetricSum): Metrics => ({
  placement: sum.n > 0 ? sum.placement / sum.n : 0,
  top3: sum.n > 0 ? sum.top3 / sum.n : 0,
  top1: sum.n > 0 ? sum.top1 / sum.n : 0,
});

function bump(map: Map<string, MetricSum>, key: string, placement: number) {
  const cell = map.get(key) ?? emptySum();
  addMetrics(cell, placement);
  map.set(key, cell);
}

export type LandmarkBaselines = {
  /** `kind:landmark:bucket` — la référence précise. */
  fine: Map<string, MetricSum>;
  /** `kind:landmark` — le repli quand la case précise est trop mince. */
  coarse: Map<string, MetricSum>;
  /** Moyenne d'ensemble par nature d'item : le point zéro de l'échelle, sans
   *  lequel on montrerait un écart et non un placement. */
  overall: Map<LandmarkKind, MetricSum>;
};

/** Le jalon d'une acquisition, ou `null` quand on ne peut pas la situer. */
function landmarkFor(
  row: ParticipantRow,
  itemId: number,
  kind: LandmarkKind,
  prismaticCount: number,
): number | null {
  if (kind === "prismatic") return prismaticCount;
  if (!row.item_order) return null;
  // Les deux tableaux parlent des mêmes identités : les formes évoluées ont été
  // ramenées à leur base dès la lecture (voir mergeEvolvedItems). Sans ça les
  // quatre items qui se transforment n'auraient aucun rang d'achat, puisque
  // l'inventaire les montre évolués et le timeline ne connaît que la base.
  const rank = row.item_order.indexOf(itemId);
  return rank === -1 ? null : rank + 1;
}

const kindOf = (itemId: number, categoryOf: ItemCategoryLookup): LandmarkKind =>
  categoryOf(itemId) === "prismatic" ? "prismatic" : "bought";

/**
 * Les références, calculées sur TOUT l'échantillon et non par champion : une
 * page de champion n'a que quelques centaines de parties, et un jalon estimé
 * là-dessus serait plus bruyant que le biais qu'il corrige.
 */
export function buildLandmarkBaselines(
  rows: ParticipantRow[],
  categoryOf: ItemCategoryLookup,
): LandmarkBaselines {
  const fine = new Map<string, MetricSum>();
  const coarse = new Map<string, MetricSum>();
  const overall = new Map<LandmarkKind, MetricSum>();

  for (const row of rows) {
    const prismaticCount = row.items.filter((id) => categoryOf(id) === "prismatic").length;
    for (const itemId of row.items) {
      if (categoryOf(itemId) === "excluded") continue;
      const kind = kindOf(itemId, categoryOf);
      const landmark = landmarkFor(row, itemId, kind, prismaticCount);
      if (landmark === null) continue;

      bump(fine, `${kind}:${landmark}:${row.skill_bucket}`, row.placement);
      bump(coarse, `${kind}:${landmark}`, row.placement);
      const all = overall.get(kind) ?? emptySum();
      addMetrics(all, row.placement);
      overall.set(kind, all);
    }
  }

  return { fine, coarse, overall };
}

function referenceFor(
  baselines: LandmarkBaselines,
  kind: LandmarkKind,
  landmark: number,
  bucket: number,
): Metrics | null {
  const precise = baselines.fine.get(`${kind}:${landmark}:${bucket}`);
  if (precise && precise.n >= LANDMARK_MIN_CELL) return meanOf(precise);
  const fallback = baselines.coarse.get(`${kind}:${landmark}`);
  return fallback ? meanOf(fallback) : null;
}

/** Bandes de créneau pour le tri « Better early / Better late », calquées sur
 *  celui des augments : tôt = 1er-2e achat, tard = 4e et au-delà. */
const ITEM_TIMING_BANDS: [label: string, min: number, max: number][] = [
  ["early", 1, 2],
  ["mid", 3, 3],
  ["late", 4, 99],
];
/** Minimum d'achats dans CHAQUE bande pour qu'un écart tôt/tard ait un sens. */
const ITEM_TIMING_MIN = 60;

export type AdjustedItemStat = { itemId: number } & Stat & {
    /** Métriques corrigées du jalon. Servent AU TIER et à rien d'autre : les
     *  colonnes affichent les brutes ci-dessus. */
    tierStat: { avgPlacement: number; top3Rate: number; top1Rate: number };
    /** Écart de % Top 3 entre un achat tardif et un achat précoce, chacun mesuré
     *  contre sa propre bande. Absent pour les prismatiques, qui ne sont pas
     *  achetés, et pour les items trop rares dans une bande. */
    timing?: { swing: number; rates: number[] };
  };

/**
 * Les stats d'un item : brutes pour l'affichage, corrigées pour le tier.
 *
 * `games` et `playRate` ne sont jamais corrigés — ce sont des comptages, pas
 * des performances.
 */
/**
 * Une case de la grille : toutes les acquisitions d'un même item qui partagent
 * la même nature, le même jalon et le même palier de niveau.
 *
 * `landmark` vaut `null` pour une acquisition qu'on ne sait pas situer — un
 * achat absent de l'ordre d'achat. Elle compte dans les colonnes affichées
 * mais pas dans la correction, comme dans la version qui parcourait les lignes.
 */
type ItemCell = {
  kind: LandmarkKind;
  landmark: number | null;
  bucket: number;
  n: number;
  placementSum: number;
  top1: number;
  top3: number;
};

/** La grille complète : les cases de chaque item. */
type ItemGrid = Map<number, ItemCell[]>;

/**
 * ─── POURQUOI LA GRILLE EXISTE ──────────────────────────────────────────────
 *
 * La correction par jalon lisait les 2,5 millions d'acquisitions d'un patch.
 * Elle lit désormais quelques milliers de CASES, qui portent la même
 * information : à jalon, palier et nature identiques, la référence soustraite
 * est la même pour toutes les acquisitions d'une case. Soustraire n fois la
 * même valeur ou la soustraire une fois multipliée par n donne le même
 * résultat, au bit près.
 *
 * C'est ce qui permet à Postgres de faire le regroupement sans que le calcul
 * ne change d'une ligne : ci-dessous, rien n'a bougé depuis la version qui
 * parcourait les participations — seul le point d'entrée a changé.
 */
function adjustedItemStatsFromGrid(
  grid: ItemGrid,
  categoryOf: ItemCategoryLookup,
  baselines: LandmarkBaselines,
  denominator: number,
): AdjustedItemStat[] {
  const raw = new Map<number, Accumulator>();
  const deltas = new Map<number, MetricSum>();
  // Par item puis par bande de créneau, pour le tri tôt/tard.
  const bands = new Map<number, MetricSum[]>();

  for (const [itemId, cells] of grid) {
    for (const c of cells) {
      const acc = raw.get(itemId) ?? { games: 0, top3Wins: 0, top1Wins: 0, placementSum: 0 };
      acc.games += c.n;
      acc.top1Wins += c.top1;
      acc.top3Wins += c.top3;
      acc.placementSum += c.placementSum;
      raw.set(itemId, acc);

      if (c.landmark === null) continue;
      const reference = referenceFor(baselines, c.kind, c.landmark, c.bucket);
      if (!reference) continue;

      const cell = deltas.get(itemId) ?? emptySum();
      cell.n += c.n;
      cell.placement += c.placementSum - c.n * reference.placement;
      cell.top3 += c.top3 - c.n * reference.top3;
      cell.top1 += c.top1 - c.n * reference.top1;
      deltas.set(itemId, cell);

      if (c.kind === "bought") {
        const landmark = c.landmark;
        const band = ITEM_TIMING_BANDS.findIndex(([, min, max]) => landmark >= min && landmark <= max);
        if (band !== -1) {
          const perBand = bands.get(itemId) ?? ITEM_TIMING_BANDS.map(() => emptySum());
          perBand[band].n += c.n;
          perBand[band].placement += c.placementSum;
          perBand[band].top3 += c.top3;
          perBand[band].top1 += c.top1;
          bands.set(itemId, perBand);
        }
      }
    }
  }

  // Référence de chaque bande, prise sur les items ÉLIGIBLES au tri et non sur
  // tous les achats : un écart n'est lu que face aux autres items du même
  // tableau, c'est donc sur eux qu'il doit être centré. Même raisonnement que
  // pour le timing des augments.
  const eligible = [...bands.entries()].filter(([, perBand]) =>
    perBand.every((b) => b.n >= ITEM_TIMING_MIN),
  );
  const bandBaseline = ITEM_TIMING_BANDS.map((_, i) => {
    let n = 0;
    let top3 = 0;
    for (const [, perBand] of eligible) {
      n += perBand[i].n;
      top3 += perBand[i].top3;
    }
    return n > 0 ? top3 / n : 0;
  });
  const timings = new Map<number, { swing: number; rates: number[] }>(
    eligible.map(([itemId, perBand]) => {
      const rates = perBand.map((b) => b.top3 / b.n);
      const swing =
        rates[rates.length - 1] - bandBaseline[bandBaseline.length - 1] - (rates[0] - bandBaseline[0]);
      return [itemId, { swing, rates }];
    }),
  );

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  return Array.from(raw.entries()).map(([itemId, acc]) => {
    const rawStat = toStat(acc, denominator);
    const delta = deltas.get(itemId);
    const zero = baselines.overall.get(kindOf(itemId, categoryOf));
    const timing = timings.get(itemId);

    // Sans jalon exploitable, le tier se rabat sur le brut plutôt que sur une
    // correction inventée.
    const tierStat =
      !delta || delta.n === 0 || !zero
        ? {
            avgPlacement: rawStat.avgPlacement,
            top3Rate: rawStat.top3Rate,
            top1Rate: rawStat.top1Rate,
          }
        : {
            avgPlacement: clamp(meanOf(zero).placement + delta.placement / delta.n, 1, 6),
            top3Rate: clamp(meanOf(zero).top3 + delta.top3 / delta.n, 0, 1),
            top1Rate: clamp(meanOf(zero).top1 + delta.top1 / delta.n, 0, 1),
          };

    return { itemId, ...rawStat, tierStat, ...(timing ? { timing } : {}) };
  });
}

/**
 * La grille bâtie en parcourant les participations — le chemin d'origine.
 *
 * Conservé pour les appels qui travaillent sur un sous-ensemble déjà en
 * mémoire (une page de champion, les parties d'enclume) et pour le repli
 * quand aucun patch n'est posé.
 */
function itemGridFromRows(
  rows: ParticipantRow[],
  categoryOf: ItemCategoryLookup,
  keep: (itemId: number) => boolean,
): ItemGrid {
  const grid: ItemGrid = new Map();
  const index = new Map<number, Map<string, ItemCell>>();

  for (const row of rows) {
    const prismaticCount = row.items.filter((id) => categoryOf(id) === "prismatic").length;
    for (const itemId of row.items) {
      if (categoryOf(itemId) === "excluded" || !keep(itemId)) continue;
      const kind = kindOf(itemId, categoryOf);
      const landmark = landmarkFor(row, itemId, kind, prismaticCount);
      const bucket = row.skill_bucket;
      const key = `${kind}:${landmark ?? ""}:${bucket}`;

      let byKey = index.get(itemId);
      if (!byKey) {
        byKey = new Map();
        index.set(itemId, byKey);
        grid.set(itemId, []);
      }
      let cell = byKey.get(key);
      if (!cell) {
        cell = { kind, landmark, bucket, n: 0, placementSum: 0, top1: 0, top3: 0 };
        byKey.set(key, cell);
        grid.get(itemId)!.push(cell);
      }
      cell.n += 1;
      cell.placementSum += row.placement;
      if (row.placement <= TOP3_PLACEMENT_THRESHOLD) cell.top3 += 1;
      if (row.placement === 1) cell.top1 += 1;
    }
  }
  return grid;
}

/** Signature d'origine, préservée pour ses trois appelants. */
export function adjustedItemStats(
  rows: ParticipantRow[],
  categoryOf: ItemCategoryLookup,
  baselines: LandmarkBaselines,
  denominator: number,
  keep: (itemId: number) => boolean,
): AdjustedItemStat[] {
  return adjustedItemStatsFromGrid(
    itemGridFromRows(rows, categoryOf, keep),
    categoryOf,
    baselines,
    denominator,
  );
}

/** Ce que `item_acquisitions` rend : une ligne par case de la grille. */
type ItemAcquisitionRow = {
  item_id: number;
  kind: LandmarkKind;
  landmark: number | null;
  skill_bucket: number;
  n: number;
  placement_sum: number;
  top1_wins: number;
  top3_wins: number;
};

/** Ce que `landmark_baselines` rend : une ligne par case de référence. */
type LandmarkBaselineRow = {
  kind: LandmarkKind;
  landmark: number;
  skill_bucket: number;
  n: number;
  placement_sum: number;
  top1_wins: number;
  top3_wins: number;
};

const addSums = (sum: MetricSum, n: number, placement: number, top3: number, top1: number) => {
  sum.n += Number(n);
  sum.placement += Number(placement);
  sum.top3 += Number(top3);
  sum.top1 += Number(top1);
};

/**
 * Les références reconstruites à partir des cases rendues par Postgres.
 *
 * `overall` se somme ici plutôt que d'être demandé à la base : il n'est que le
 * total des cases, et le demander séparément ferait un second parcours de
 * 2,5 M d'acquisitions pour une valeur déjà présente.
 */
function landmarkBaselinesFromRows(rows: LandmarkBaselineRow[]): LandmarkBaselines {
  const fine = new Map<string, MetricSum>();
  const coarse = new Map<string, MetricSum>();
  const overall = new Map<LandmarkKind, MetricSum>();

  for (const r of rows) {
    const kind = r.kind;
    const landmark = Number(r.landmark);
    const bucket = Number(r.skill_bucket);

    const f = fine.get(`${kind}:${landmark}:${bucket}`) ?? emptySum();
    addSums(f, r.n, r.placement_sum, r.top3_wins, r.top1_wins);
    fine.set(`${kind}:${landmark}:${bucket}`, f);

    const c = coarse.get(`${kind}:${landmark}`) ?? emptySum();
    addSums(c, r.n, r.placement_sum, r.top3_wins, r.top1_wins);
    coarse.set(`${kind}:${landmark}`, c);

    const o = overall.get(kind) ?? emptySum();
    addSums(o, r.n, r.placement_sum, r.top3_wins, r.top1_wins);
    overall.set(kind, o);
  }
  return { fine, coarse, overall };
}

/** La grille reconstruite à partir des cases rendues par Postgres. */
function itemGridFromRows_sql(rows: ItemAcquisitionRow[]): ItemGrid {
  const grid: ItemGrid = new Map();
  for (const r of rows) {
    const itemId = Number(r.item_id);
    const cells = grid.get(itemId) ?? [];
    cells.push({
      kind: r.kind,
      landmark: r.landmark === null ? null : Number(r.landmark),
      bucket: Number(r.skill_bucket),
      n: Number(r.n),
      placementSum: Number(r.placement_sum),
      top1: Number(r.top1_wins),
      top3: Number(r.top3_wins),
    });
    grid.set(itemId, cells);
  }
  return grid;
}

/**
 * Sixième agrégation descendue en base — et la seule où le calcul déplacé
 * n'est PAS celui qui compte.
 *
 * Ce qui descend, ce sont les deux réductions : la grille des acquisitions
 * (item × nature × jalon × palier) et les références par case. Ce qui reste
 * ici, c'est la correction elle-même — le repli de la case fine vers la
 * grossière, le recentrage sur la moyenne d'ensemble, le tri tôt/tard. C'est
 * la partie qui a demandé de la mesure, et elle n'a pas changé d'une ligne :
 * `adjustedItemStatsFromGrid` est appelé à l'identique par les deux chemins.
 *
 * Trois formulations SQL ont été nécessaires pour tenir dans le budget, la
 * dernière passant de 26,8 s à 8,9 s en supprimant une jointure sur
 * `match_id` — voir le commentaire de `landmark_baselines`.
 *
 * ─── VÉRIFIÉ, ET COMMENT ────────────────────────────────────────────────────
 *
 * Crawler gelé, deux publications sur la même vue (418 218 participations des
 * deux côtés) et SURTOUT aucune phase classement entre les deux :
 *
 *   games, playRate, avgPlacement, top3Rate, top1Rate   identiques 170/170
 *   tierStat                                 écart max 7,8 × 10⁻¹⁴
 *
 * Soit du bruit d'arrondi : l'ordre de sommation change, le résultat
 * mathématique non. Aucun item au-delà de 10⁻¹².
 *
 * Le « aucune phase classement entre les deux » n'est pas une précaution de
 * style. Une première tentative de comparaison montrait 0,0034 d'écart sur
 * tierStat, et j'ai failli abandonner la migration là-dessus : j'appelais
 * `?only=ratings` entre les deux publications, pour lire la révision déployée.
 * Or cette phase réécrit `player_ratings`, dont dérive le `skill_bucket` de
 * chaque participation, dont dépend la référence de chaque case de jalon.
 * Je mesurais l'effet de mon propre appel.
 *
 * Le symptôme le disait : SEUL tierStat bougeait, alors que toutes les sorties
 * indépendantes du palier étaient identiques au bit près. Une différence qui
 * ne touche qu'une seule sortie désigne son entrée.
 */
export async function getItemStats(categoryOf: ItemCategoryLookup) {
  const set = await fetchParticipantSet();
  if (set.patch && supabaseAdmin) {
    const [acqRes, baseRes, countRes] = await Promise.all([
      supabaseAdmin.rpc("item_acquisitions", { target_patch: set.patch }),
      supabaseAdmin.rpc("landmark_baselines", { target_patch: set.patch }),
      supabaseAdmin.rpc("patch_match_count", { target_patch: set.patch }),
    ]);
    if (acqRes.error) throw acqRes.error;
    if (baseRes.error) throw baseRes.error;
    if (countRes.error) throw countRes.error;

    const totalMatches = Number(countRes.data ?? 0);
    const items = adjustedItemStatsFromGrid(
      itemGridFromRows_sql((acqRes.data ?? []) as ItemAcquisitionRow[]),
      categoryOf,
      landmarkBaselinesFromRows((baseRes.data ?? []) as LandmarkBaselineRow[]),
      totalMatches * PARTICIPANTS_PER_MATCH,
    ).sort((a, b) => b.top3Rate - a.top3Rate);
    return { totalMatches, items };
  }

  const rows = set.rows;
  const totalMatches = matchCountOf(rows);
  const baselines = landmarkBaselinesOf(rows, categoryOf);
  const items = adjustedItemStats(
    rows,
    categoryOf,
    baselines,
    totalMatches * PARTICIPANTS_PER_MATCH,
    () => true,
  ).sort((a, b) => b.top3Rate - a.top3Rate);
  return { totalMatches, items };
}

/**
 * Deuxième agrégation descendue en base — même contrat que `getChampionStats`.
 *
 * L'exclusion des augments d'événement se fait désormais dans la requête, par
 * jointure à `ref_augments`. Côté JS elle vivait dans `dropExcludedAugments`,
 * appliqué une fois à la lecture pour que les quatre endroits qui agrègent des
 * augments ne puissent pas l'oublier. La jointure joue le même rôle : un
 * augment exclu n'atteint aucun compteur, quelle que soit la requête.
 */
export async function getAugmentStats() {
  const set = await fetchParticipantSet();
  if (set.patch && supabaseAdmin) {
    const [{ data, error }, { data: matchCount, error: countError }] = await Promise.all([
      supabaseAdmin.rpc("augment_stats", { target_patch: set.patch }),
      supabaseAdmin.rpc("patch_match_count", { target_patch: set.patch }),
    ]);
    if (error) throw error;
    if (countError) throw countError;

    const totalMatches = Number(matchCount ?? 0);
    const augments = ((data ?? []) as AugmentStatsRow[])
      .map((r) => ({
        augmentId: Number(r.augment_id),
        ...toStat(
          {
            games: Number(r.games),
            top3Wins: Number(r.top3_wins),
            top1Wins: Number(r.top1_wins),
            placementSum: Number(r.placement_sum),
          },
          totalMatches * PARTICIPANTS_PER_MATCH,
        ),
      }))
      .sort((a, b) => b.top3Rate - a.top3Rate);
    return { totalMatches, augments };
  }

  const rows = set.rows;
  const totalMatches = matchCountOf(rows);
  const byAugment = new Map<number, Accumulator>();
  for (const r of rows) {
    for (const augmentId of r.augments) accumulate(byAugment, augmentId, r.placement);
  }
  const augments = Array.from(byAugment.entries())
    .map(([augmentId, s]) => ({ augmentId, ...toStat(s, totalMatches * PARTICIPANTS_PER_MATCH) }))
    .sort((a, b) => b.top3Rate - a.top3Rate);
  return { totalMatches, augments };
}

/** Ce que `augment_stats` rend : des compteurs, jamais des taux. */
type AugmentStatsRow = {
  augment_id: number;
  games: number;
  top1_wins: number;
  top3_wins: number;
  placement_sum: number;
};

/**
 * Le seuil de parties minimum ne vit plus ici : `player_ratings` ne contient
 * que des joueurs déjà au-dessus de RATING_MIN_GAMES (voir lib/rating.ts), et
 * cette table est désormais la source du classement. Le garder en double ici
 * aurait donné deux seuils à changer pour un seul réglage.
 *
 * Il reste indispensable : mesuré le 2026-09-14, 14 131 des 17 588 joueurs
 * suivis n'avaient qu'une seule partie. À une partie on fait 0 % ou 100 % de
 * top 3 — ces lignes ne classent personne, elles ne font que peser.
 */

type LeaderboardRpcRow = {
  puuid: string;
  riot_id: string;
  games: number;
  top3_wins: number;
  top1_wins: number;
  placement_sum: number;
  rank_position: number;
  tier: string;
};

/** Combien de joueurs le classement publie.
 *
 *  Un plafond DÉCIDÉ, et non plus subi : la page rend chaque ligne dans son
 *  HTML, à ~276 octets de JSON par joueur. Publier les 8 467 classés ferait un
 *  snapshot de 2,3 Mo et une page bien plus lourde — qui grossirait chaque
 *  jour. Au-delà du millième, personne ne parcourt un classement : on y cherche
 *  quelqu'un, et la page joueur donne le rang exact de n'importe qui. */
export const LEADERBOARD_MAX_ROWS = 1000;

/**
 * Le haut du classement, trié et borné par Postgres (`leaderboard_top`).
 *
 * Seul agrégateur à avoir besoin de `puuid`/`riot_id`, les deux colonnes les
 * plus lourdes de la table — d'où ce chemin distinct, qui les laisse en base.
 *
 * Le tri et la coupe se font EN SQL, pas ici. La version précédente lisait les
 * stats et les rangs par deux requêtes séparées puis les recollait en mémoire :
 * PostgREST plafonnait chacune à 1 000 lignes sans le dire, et l'intersection
 * de deux échantillons arbitraires de 8 467 joueurs ne contenait presque
 * personne. La page affichait 1 000 joueurs dont 775 sans rang, et 112
 * seulement du vrai top 1 000. Trier en mémoire ne rattrape jamais ce qu'une
 * lecture tronquée n'a pas rapporté.
 */
export async function getLeaderboardStats() {
  if (!supabaseAdmin) return { totalMatches: 0, players: [], totalRanked: 0 };

  const [{ totalMatches }, { data, error }, { count, error: countError }] = await Promise.all([
    getSiteStats(),
    supabaseAdmin
      .rpc("leaderboard_top", { max_rows: LEADERBOARD_MAX_ROWS })
      // Explicite, pour que la borne vienne du code et pas d'un réglage serveur
      // qu'on découvre le jour où la base le dépasse.
      .range(0, LEADERBOARD_MAX_ROWS - 1),
    // Le total sert à dire « top 1 000 sur 8 467 » : un rang ne se lit pas sans
    // savoir sur combien.
    supabaseAdmin.from("player_ratings").select("puuid", { count: "exact", head: true }),
  ]);
  if (error) throw error;
  if (countError) throw countError;

  // Déjà trié par `rank_position` côté SQL : aucun tri à refaire ici.
  const players = ((data ?? []) as LeaderboardRpcRow[]).map((r) => ({
    puuid: r.puuid,
    riotId: r.riot_id,
    tier: r.tier,
    position: r.rank_position,
    ...toStat(
      {
        games: Number(r.games),
        top3Wins: Number(r.top3_wins),
        top1Wins: Number(r.top1_wins),
        placementSum: Number(r.placement_sum),
      },
      totalMatches,
    ),
  }));

  return { totalMatches, players, totalRanked: count ?? players.length };
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
/**
 * Le puuid traduit en identifiant entier.
 *
 * Le puuid ne vit plus sur la participation depuis la compression du
 * 2026-09-22 : 79 octets par ligne, répétés 1,29 M de fois, pour une
 * information que `players` porte déjà une fois par joueur. Une sonde sur
 * `players_puuid_key` fait la traduction — une lecture d'index, qui remplace
 * le transport de 79 octets sur chaque ligne lue ensuite.
 *
 * Séparée de la lecture des lignes depuis l'archivage : les participations
 * brutes et les compteurs archivés partent tous deux de cet identifiant, et
 * rien ne justifie de le résoudre deux fois.
 */
async function resolvePlayerId(puuid: string): Promise<number | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("players")
    .select("id")
    .eq("puuid", puuid)
    .maybeSingle();
  if (error) throw error;
  // Joueur jamais croisé en partie : `null` est la bonne réponse, et la page
  // affiche déjà le cas « aucune partie connue ».
  return data ? (data.id as number) : null;
}

async function fetchPlayerRowsById(playerId: number): Promise<ParticipantRow[]> {
  if (!supabaseAdmin) return [];

  const rows: ParticipantRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from(PARTICIPANT_SOURCE)
      .select(PARTICIPANT_COLUMNS)
      .eq("player_id", playerId)
      .order("match_id", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as CompactRow[]).map(expandRow));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return dropExcludedAugments(rows);
}

/**
 * La carrière archivée d'un joueur, patchs sortis de la fenêtre publiée.
 *
 * Les participations brutes ne sont gardées que pour les deux patchs publiés
 * (voir supabase/migrations/20260922-retention-et-rollup.sql). Au-delà, il
 * reste une ligne par (joueur, champion, patch) portant des COMPTEURS BRUTS :
 * `games`, `top1_wins`, `top3_wins`, `placement_sum`.
 *
 * Bruts, et non des moyennes, précisément pour ce calcul : une moyenne ne
 * s'additionne pas. Un joueur à 3,0 de placement moyen sur 40 parties et 5,0
 * sur 2 n'est pas à 4,0 — il est à 3,1. Les sommes, elles, se recombinent
 * exactement, si bien que la carrière complète donne le même chiffre qu'avant
 * l'archivage.
 */
async function fetchPlayerArchive(playerId: number): Promise<Map<string, Accumulator>> {
  const byChampion = new Map<string, Accumulator>();
  if (!supabaseAdmin) return byChampion;

  const { data, error } = await supabaseAdmin
    .from("player_champion_totals")
    .select("champion, games, top1_wins, top3_wins, placement_sum")
    .eq("player_id", playerId);
  if (error) throw error;

  // Un joueur a une ligne PAR PATCH pour un même champion : on les additionne.
  for (const row of data ?? []) {
    const champion = row.champion as string;
    const acc = byChampion.get(champion) ?? { games: 0, top3Wins: 0, top1Wins: 0, placementSum: 0 };
    acc.games += Number(row.games);
    acc.top1Wins += Number(row.top1_wins);
    acc.top3Wins += Number(row.top3_wins);
    acc.placementSum += Number(row.placement_sum);
    byChampion.set(champion, acc);
  }
  return byChampion;
}

/** Everything about one player scoped to their own games — powers the player
 * profile page.
 *
 * Deux sources depuis l'archivage du 2026-09-24 : les participations encore
 * en base (les deux patchs publiés) et les compteurs archivés (tout le reste).
 * Les additionner ici plutôt que de garder 1,2 M de participations dont c'est
 * le seul lecteur.
 */
export async function getPlayerProfile(puuid: string): Promise<PlayerProfile> {
  const playerId = await resolvePlayerId(puuid);
  if (playerId === null) {
    return { games: 0, top1Rate: 0, top3Rate: 0, avgPlacement: 0, champions: [] };
  }

  const [playerRows, byChampion] = await Promise.all([
    fetchPlayerRowsById(playerId),
    fetchPlayerArchive(playerId),
  ]);

  // Les parties encore brutes s'ajoutent aux compteurs archivés, champion par
  // champion. `accumulate` crée l'entrée si le joueur n'a ce champion que sur
  // un patch publié.
  for (const r of playerRows) accumulate(byChampion, r.champion, r.placement);

  const overallAcc: Accumulator = { games: 0, top3Wins: 0, top1Wins: 0, placementSum: 0 };
  for (const acc of byChampion.values()) {
    overallAcc.games += acc.games;
    overallAcc.top1Wins += acc.top1Wins;
    overallAcc.top3Wins += acc.top3Wins;
    overallAcc.placementSum += acc.placementSum;
  }
  const totalGames = overallAcc.games;

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

/**
 * ─── LES SEUILS DES ONGLETS D'UN CHAMPION ────────────────────────────────────
 *
 * Un champion a quelques centaines de parties sur un patch, pas 27 000. Sous ce
 * nombre de parties, une ligne ne dit plus rien : elle occupe une place dans un
 * tableau, elle se fait classer, et le lecteur la lit comme une information
 * alors qu'elle n'est que du bruit. Le plancher de confiance des tiers (voir
 * lib/tiers.ts) l'empêche déjà de REMONTER ; le seuil, lui, l'empêche d'exister.
 *
 * Mesuré sur le patch 16.18 : un champion voit 182 augments et 121 items au
 * moins une fois. À partir de cinq parties il en reste 115 et 79 — on perd des
 * lignes à une ou deux parties, jamais un vrai choix de build.
 *
 * Le seuil s'applique AVANT le calcul des tiers, et donc aussi au top 5 du
 * résumé : les deux vues doivent classer le même lot, sinon un augment serait
 * A sur une page et B sur l'autre.
 */
const CHAMPION_LIST_MIN_GAMES = 5;

/** Les enclumes sont un style de jeu minoritaire : le même seuil y couperait
 *  presque tout. Plus bas, donc, et l'onglet affiche son échantillon. */
const CHAMPION_ANVIL_MIN_GAMES = 3;

/**
 * Les paires demandent un seuil PLUS HAUT que les listes simples, et pour une
 * raison qui n'est pas le volume de données.
 *
 * Un champion forme des centaines de paires — 674 au-dessus de cinq parties
 * chez Sett — là où il ne voit que 182 augments. Or plus on teste de candidats,
 * plus le plus extrême d'entre eux paraît extrême, même quand rien de réel ne
 * le distingue : c'est le problème des comparaisons multiples, et il ne se
 * corrige pas en regardant chaque ligne isolément. À cinq parties, la tête du
 * classement était occupée par des paires vues dix fois à 90 % de top 1.
 *
 * Doubler le seuil ne supprime pas le phénomène, il le rend beaucoup moins
 * probable, et il reste de quoi remplir la liste : 379 paires objet-objet chez
 * Sett au-dessus de dix parties.
 */
const CHAMPION_COMBO_MIN_GAMES = 10;

/** On publie les meilleures paires par catégorie, pas toutes : au-delà, on ne
 *  classe plus que du hasard. */
const CHAMPION_COMBO_MAX = 60;

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
    /** Les anvil runs de ce champion selon qu'ils ont commencé, ou non, par un
     *  des quatre augments d'enclume — voir ANVIL_OPENER_AUGMENTS. */
    anvilOpening: ChampionAnvilOpening;
    /** % of this champion's anvil-run games (not all games) where Shardblade was obtained. */
    anvilShardbladeRate: number;
    /** Top 3 Prismatic items among this champion's anvil-run games, ranked by tier score. */
    anvilTopPrismaticItems: ChampionItemSlotStat[];
    /** Top 10 combos per category, scoped to this champion's own games. */
    championCombos: Record<ComboCategory, ComboStat[]>;

    // ── Ce que les onglets affichent, et que le résumé ne montre qu'en extrait.
    //    Empaqueté (voir PackedStat) : ce sont les seules listes longues du site.

    /** Tous les augments vus sur ce champion, au-dessus du seuil. */
    allAugments: PackedStat[];
    /** Tous les items vus sur ce champion, au-dessus du seuil, tier compris. */
    allItems: PackedItemStat[];
    /** Les meilleures paires par catégorie, au-dessus du seuil. */
    allCombos: Record<ComboCategory, PackedCombo[]>;
    /** Les prismatiques des parties « enclume » de ce champion. */
    anvilItems: PackedItemStat[];
    /** Les augments des parties « enclume » de ce champion. */
    anvilAugments: PackedStat[];
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
  topN: number,
  /** Références calculées sur tout l'échantillon (voir buildLandmarkBaselines) :
   *  sans elles, un prismatique tardif remonte ici pour la même raison que sur
   *  la tier list générale — il n'arrive que dans les parties qui ont duré. */
  baselines: LandmarkBaselines,
): ChampionItemSlotStat[] {
  const stats = adjustedItemStats(
    rows,
    categoryOf,
    baselines,
    denominator,
    (itemId) => categoryOf(itemId) === "prismatic",
  );
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
  const totalMatches = matchCountOf(rows);
  const champRows = championRowsOf(rows).get(championIdLower) ?? [];
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
  const allAugments: PackedStat[] = [];
  for (const [augmentId, s] of byAugment.entries()) {
    // Le seuil AVANT le tier, pour que le top 5 du résumé et l'onglet classent
    // exactement le même lot — voir CHAMPION_LIST_MIN_GAMES.
    if (s.games < CHAMPION_LIST_MIN_GAMES) continue;
    const rarity = rarityOf(augmentId);
    if (!rarity) continue;
    allAugments.push(packStat(augmentId, s));
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
  // Seul l'item PRINCIPAL d'un slot est retiré des slots suivants.
  //
  // La règle d'origine retirait tout ce qui avait été montré, alternatives
  // comprises. Elle répondait à un vrai défaut : chaque slot choisissait ses
  // trois items indépendamment des autres, et comme un même légendaire est
  // acheté en 1er par certains joueurs et en 2e par d'autres, il ressortait en
  // tête de plusieurs slots d'affilée. Mesuré avant correction, les
  // **173 champions** étaient concernés — Death's Dance en tête des slots 3, 4,
  // 5 et 6 chez Fiora. Le chiffre n'était pas faux, mais un build qui répète
  // quatre fois le même item se lit comme un bug, pas comme une recommandation.
  //
  // Elle allait trop loin dans l'autre sens. Un item classé 2e ou 3e d'un slot
  // n'est pas ce qu'on recommande à ce slot-là : c'est une variante. Le retirer
  // de toute la suite du build privait les slots suivants d'items que beaucoup
  // de joueurs achètent vraiment à ce moment-là, et ce qui restait à afficher
  // devenait de plus en plus marginal à mesure qu'on avançait dans le build.
  //
  // La règle est donc asymétrique, et c'est voulu :
  //   · item PRINCIPAL d'un slot   → il n'apparaît plus ensuite ;
  //   · item secondaire ou tertiaire → il reste disponible pour la suite, et
  //     peut très bien devenir le principal d'un slot ultérieur.
  //
  // Ce qui suffit à empêcher la répétition qu'on corrigeait : c'est la ligne des
  // principaux qui se lit comme LE build, et elle n'a plus de doublon.
  //
  // Ne concerne en pratique que les slots légendaires : les bottes (slot 1) et
  // les prismatiques (slot 2) ont leurs propres catégories, exclues des autres.
  const itemBuild: ChampionItemSlot[] = [];
  const alreadyPrimary = new Set<number>();
  bySlot.forEach((slotMap, i) => {
    const items = Array.from(slotMap.entries())
      .filter(([itemId]) => !alreadyPrimary.has(itemId))
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
    // Le principal seulement — voir la note ci-dessus.
    alreadyPrimary.add(items[0].itemId);
    itemBuild.push({ slot: i + 1, items });
  });

  // Références du jalon calculées sur TOUT l'échantillon, pas sur les seules
  // parties de ce champion : quelques centaines de parties ne suffisent pas à
  // estimer une moyenne par jalon, et une référence bruitée corrigerait de
  // travers.
  const baselines = landmarkBaselinesOf(rows, itemCategoryOf);

  // Top 6 Prismatic items across this champion's games overall (any
  // playstyle) — sits under the item build slots.
  const topPrismaticItems = computeTopPrismaticItems(
    champRows,
    itemCategoryOf,
    champGames,
    6,
    baselines,
  );

  const anvilRows = champRows.filter((r) => isAnvilBuild(r.items, itemCategoryOf));
  const anvilAcc: Accumulator = { games: 0, top3Wins: 0, top1Wins: 0, placementSum: 0 };
  // Les quatre augments d'enclume sont REGROUPÉS ici, alors que la tier list
  // les sépare. Ce n'est pas une simplification, c'est ce que l'échantillon
  // autorise : séparés, 34 champions sur 173 seulement atteignent 10 parties
  // sur « Stats! ». Regroupés, les 173 y sont, avec une médiane de 36 parties
  // par champion et par patch. Et l'écart mesuré est le même d'un champion à
  // l'autre — environ une demi-place — donc la distinction se paierait en
  // bruit sans rien apprendre de plus.
  const openedOnAnvil = new Map<string, Accumulator>();
  let anvilShardbladeCount = 0;
  for (const r of anvilRows) {
    anvilAcc.games += 1;
    anvilAcc.placementSum += r.placement;
    if (r.placement <= TOP3_PLACEMENT_THRESHOLD) anvilAcc.top3Wins += 1;
    if (r.placement === 1) anvilAcc.top1Wins += 1;
    if (r.items.includes(SHARDBLADE_ITEM_ID)) anvilShardbladeCount += 1;
    const opener = r.augments[0];
    const key = opener !== undefined && ANVIL_OPENER_SET.has(opener) ? "stat" : "other";
    accumulate(openedOnAnvil, key, r.placement);
  }
  const anvilShardbladeRate = anvilAcc.games > 0 ? anvilShardbladeCount / anvilAcc.games : 0;
  const anvilOpening: ChampionAnvilOpening = {
    statAnvil: outcomeOf(openedOnAnvil.get("stat")),
    other: outcomeOf(openedOnAnvil.get("other")),
  };

  // Top 3 Prismatic items among just this champion's anvil-run games.
  const anvilTopPrismaticItems = computeTopPrismaticItems(
    anvilRows,
    itemCategoryOf,
    anvilAcc.games,
    3,
    baselines,
  );

  // Les paires de ce champion. Le seuil remplace l'absence de seuil d'avant :
  // le résumé n'en montrait que dix, et une paire à deux parties y passait
  // inaperçue ; un onglet qui en montre soixante ne peut pas se le permettre.
  // Voir CHAMPION_COMBO_MIN_GAMES pour le choix du nombre.
  const packedCombos = computeCombos(
    champRows,
    itemCategoryOf,
    CHAMPION_COMBO_MIN_GAMES,
    CHAMPION_COMBO_MAX,
  );
  const championCombos = Object.fromEntries(
    Object.entries(packedCombos).map(([category, list]) => [
      category,
      list.slice(0, 10).map((combo) => unpackCombo(combo, champGames)),
    ]),
  ) as Record<ComboCategory, ComboStat[]>;

  // Tous les items de ce champion, tier compris — le même calcul que la tier
  // list générale, mais sur les seules parties de ce champion et avec les
  // références de jalon de tout l'échantillon (voir buildLandmarkBaselines).
  //
  // Les compteurs sont reconstitués depuis les taux. C'est exact et non
  // approché : `top1Rate` vaut `top1Wins / games` et les deux sont des entiers
  // bien en deçà de la précision d'un flottant — le produit retombe sur
  // l'entier de départ. L'alternative serait de faire ressortir l'accumulateur
  // d'`adjustedItemStats`, pour élargir sa signature au profit d'un seul appel.
  const allItems = adjustedItemStats(champRows, itemCategoryOf, baselines, champGames, () => true)
    .filter((i) => i.games >= CHAMPION_LIST_MIN_GAMES)
    .map<PackedItemStat>((i) => [
      i.itemId,
      i.games,
      Math.round(i.top1Rate * i.games),
      Math.round(i.top3Rate * i.games),
      Math.round(i.avgPlacement * i.games),
      round4(i.tierStat.avgPlacement),
      round4(i.tierStat.top3Rate),
      round4(i.tierStat.top1Rate),
    ]);

  const anvilItems = adjustedItemStats(
    anvilRows,
    itemCategoryOf,
    baselines,
    anvilAcc.games,
    (itemId) => itemCategoryOf(itemId) === "prismatic",
  )
    .filter((i) => i.games >= CHAMPION_ANVIL_MIN_GAMES)
    .map<PackedItemStat>((i) => [
      i.itemId,
      i.games,
      Math.round(i.top1Rate * i.games),
      Math.round(i.top3Rate * i.games),
      Math.round(i.avgPlacement * i.games),
      round4(i.tierStat.avgPlacement),
      round4(i.tierStat.top3Rate),
      round4(i.tierStat.top1Rate),
    ]);

  const anvilByAugment = new Map<number, Accumulator>();
  for (const r of anvilRows) {
    for (const augmentId of r.augments) accumulate(anvilByAugment, augmentId, r.placement);
  }
  const anvilAugments: PackedStat[] = [];
  for (const [augmentId, acc] of anvilByAugment) {
    if (acc.games < CHAMPION_ANVIL_MIN_GAMES) continue;
    anvilAugments.push(packStat(augmentId, acc));
  }

  return {
    champion: champRows[0].champion,
    totalMatches,
    ...toStat(championAcc, totalMatches * PARTICIPANTS_PER_MATCH),
    augmentsByRarity,
    itemBuild,
    topPrismaticItems,
    anvilStat: toStat(anvilAcc, champGames),
    anvilOpening,
    anvilShardbladeRate,
    anvilTopPrismaticItems,
    championCombos,
    allAugments,
    allItems,
    allCombos: packedCombos,
    anvilItems,
    anvilAugments,
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

/** Ce que `augment_timing` rend : des compteurs par créneau, jamais des taux. */
type AugmentTimingRow = {
  slot: number;
  augment_id: number;
  games: number;
  top1_wins: number;
  top3_wins: number;
  placement_sum: number;
};

/**
 * Cinquième agrégation descendue en base — mais seulement le DÉCOMPTE.
 *
 * L'éligibilité, les références par créneau et le calcul du swing restent
 * ici : ils travaillent sur ~96 augments, ils sont documentés et mesurés, et
 * les descendre n'économiserait rien puisque l'échantillon est déjà réduit.
 *
 * Le SQL renumérote les créneaux APRÈS avoir retiré les augments d'événement,
 * parce que c'est ce que fait `dropExcludedAugments` avant le `slice(0, 3)` :
 * le tableau est compacté, donc un exclu en première position décale tout le
 * reste d'un cran. Numéroter sur la position d'origine aurait produit des
 * chiffres légèrement faux, sans aucune erreur pour le signaler.
 */
export async function getAugmentTimingStats(): Promise<AugmentTimingStats> {
  const set = await fetchParticipantSet();

  const perSlot: Map<number, Accumulator>[] = Array.from(
    { length: TIMING_SLOTS },
    () => new Map()
  );
  let totalMatches: number;

  if (set.patch && supabaseAdmin) {
    const [{ data, error }, { data: matchCount, error: countError }] = await Promise.all([
      supabaseAdmin.rpc("augment_timing", { target_patch: set.patch, slots: TIMING_SLOTS }),
      supabaseAdmin.rpc("patch_match_count", { target_patch: set.patch }),
    ]);
    if (error) throw error;
    if (countError) throw countError;

    totalMatches = Number(matchCount ?? 0);
    for (const r of (data ?? []) as AugmentTimingRow[]) {
      const index = Number(r.slot) - 1;
      if (index < 0 || index >= TIMING_SLOTS) continue;
      perSlot[index].set(
        Number(r.augment_id),
        acc(r.games, r.top1_wins, r.top3_wins, r.placement_sum),
      );
    }
  } else {
    const rows = set.rows;
    totalMatches = matchCountOf(rows);
    for (const row of rows) {
      row.augments.slice(0, TIMING_SLOTS).forEach((augmentId, index) => {
        accumulate(perSlot[index], augmentId, row.placement);
      });
    }
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

/** Ce que `comp_archetypes` rend : des compteurs, jamais des taux. */
type CompArchetypeRow = {
  roles: string[];
  games: number;
  top1_wins: number;
  top3_wins: number;
  placement_sum: number;
};

type CompCoverageRow = {
  total_teams: number;
  trios_distincts: number;
  trios_repetes: number;
  duos_distincts: number;
  duos_exploitables: number;
};

/**
 * Troisième agrégation descendue en base.
 *
 * Celle-ci regroupe DEUX fois : d'abord les participations en équipes, puis les
 * équipes en archétypes. C'est la seule agrégation du fichier dont l'unité
 * n'est pas la participation — le placement est une propriété de l'équipe.
 *
 * Deux fonctions plutôt qu'une : les archétypes rendent une ligne par forme,
 * la couverture une seule ligne de compteurs. Les faire tenir dans un même
 * résultat demanderait de mélanger deux formes dans une même colonne.
 *
 * `roleOf` reste dans la signature pour le chemin de repli — la version SQL
 * lit `ref_champions`, projection des mêmes JSON, jointe EN MINUSCULES parce
 * que Riot écrit « FiddleSticks » là où Data Dragon écrit « Fiddlesticks »
 * (même contournement que championsByIdLower côté app).
 */
export async function getCompStats(
  roleOf: (champion: string) => string | undefined
): Promise<CompStats> {
  const set = await fetchParticipantSet();
  if (set.patch && supabaseAdmin) {
    const [archetypeRes, coverageRes, matchCountRes] = await Promise.all([
      supabaseAdmin.rpc("comp_archetypes", {
        target_patch: set.patch,
        min_teams: ARCHETYPE_MIN_TEAMS,
      }),
      supabaseAdmin.rpc("comp_coverage", {
        target_patch: set.patch,
        duo_usable_teams: DUO_USABLE_TEAMS,
      }),
      supabaseAdmin.rpc("patch_match_count", { target_patch: set.patch }),
    ]);
    if (archetypeRes.error) throw archetypeRes.error;
    if (coverageRes.error) throw coverageRes.error;
    if (matchCountRes.error) throw matchCountRes.error;

    const cover = ((coverageRes.data ?? []) as CompCoverageRow[])[0];
    const totalTeams = Number(cover?.total_teams ?? 0);
    const archetypes = ((archetypeRes.data ?? []) as CompArchetypeRow[])
      .map((r) => ({
        roles: r.roles,
        ...toStat(
          {
            games: Number(r.games),
            top3Wins: Number(r.top3_wins),
            top1Wins: Number(r.top1_wins),
            placementSum: Number(r.placement_sum),
          },
          totalTeams,
        ),
      }))
      .sort((a, b) => b.top3Rate - a.top3Rate);

    return {
      totalMatches: Number(matchCountRes.data ?? 0),
      totalTeams,
      archetypes,
      coverage: {
        trios: {
          distinct: Number(cover?.trios_distincts ?? 0),
          repeated: Number(cover?.trios_repetes ?? 0),
        },
        duos: {
          distinct: Number(cover?.duos_distincts ?? 0),
          usable: Number(cover?.duos_exploitables ?? 0),
        },
      },
    };
  }

  const rows = set.rows;
  const totalMatches = matchCountOf(rows);
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

/**
 * Un choix encodé en entier, pour servir de clé sans passer par une chaîne.
 *
 * Le drapeau de type est AU-DESSUS de l'identifiant, et pas en bit de poids
 * faible : c'est ce qui fait que l'ordre des entiers reproduit exactement
 * l'ordre canonique d'`orderComboPick` — tous les objets avant tous les
 * augments, puis l'identifiant. Avec le drapeau en bas, un objet d'identifiant
 * 200 000 se serait classé après un augment d'identifiant 900, et la paire
 * affichée aurait changé de sens.
 *
 * L'écart laisse deux millions d'identifiants possibles ; les objets montent
 * aujourd'hui à ~450 000. Une paire vaut donc au plus 2^46, loin du plus grand
 * entier exact de JavaScript (2^53).
 */
const PICK_TYPE_OFFSET = 1 << 22;
const PICK_PAIR_BASE = 1 << 23;

function decodePick(code: number): ComboPick {
  return code >= PICK_TYPE_OFFSET
    ? { type: "augment", id: code - PICK_TYPE_OFFSET }
    : { type: "item", id: code };
}

// Shared by the site-wide Combos tier list and the per-champion mini combo
// tables — only `rows`, the eligibility threshold, and the per-category cap
// differ between the two call sites.
function computeCombos(
  rows: ParticipantRow[],
  itemCategoryOf: ItemCategoryLookup,
  minGames: number,
  maxPerCategory: number
): Record<ComboCategory, PackedCombo[]> {
  // Clé NUMÉRIQUE, et non `${a.type}:${a.id}|${b.type}:${b.id}`.
  //
  // C'est la boucle la plus chaude du calcul : chaque participation forme une
  // douzaine de choix, donc une soixantaine de paires, et il y a 228 000
  // participations — plus de quinze millions de clés, construites puis hachées
  // comme chaînes. Profilé le 2026-09-16, `combos` pesait 28 % de l'agrégation
  // du site, sans compter sa part dans les pages de champion, qui appellent la
  // même fonction.
  //
  // Un choix tient dans un entier (voir `pickCode`), une paire dans un autre,
  // et l'ordre des entiers reproduit exactement l'ordre canonique de
  // `orderComboPick` : le drapeau de type est au-dessus de l'identifiant, donc
  // tous les objets se classent avant tous les augments, et à type égal c'est
  // l'identifiant qui tranche. Ce qui est affiché en `a` reste donc ce qui
  // l'était.
  type ComboAcc = Accumulator & { code: number; category: ComboCategory };
  const combos = new Map<number, ComboAcc>();
  const picks: number[] = [];

  for (const r of rows) {
    picks.length = 0;
    for (const id of r.items) {
      const category = itemCategoryOf(id);
      if (category === "excluded" || category === "boots") continue;
      picks.push(id);
    }
    for (const id of r.augments) picks.push(PICK_TYPE_OFFSET + id);

    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        const x = picks[i];
        const y = picks[j];
        const lo = x <= y ? x : y;
        const hi = x <= y ? y : x;
        const key = lo * PICK_PAIR_BASE + hi;
        let entry = combos.get(key);
        if (!entry) {
          entry = {
            code: key,
            category:
              hi < PICK_TYPE_OFFSET
                ? "item-item"
                : lo >= PICK_TYPE_OFFSET
                  ? "augment-augment"
                  : "item-augment",
            games: 0,
            top3Wins: 0,
            top1Wins: 0,
            placementSum: 0,
          };
          combos.set(key, entry);
        }
        entry.games += 1;
        entry.placementSum += r.placement;
        if (r.placement <= TOP3_PLACEMENT_THRESHOLD) entry.top3Wins += 1;
        if (r.placement === 1) entry.top1Wins += 1;
      }
    }
  }

  const byCategory: Record<ComboCategory, PackedCombo[]> = {
    "item-item": [],
    "augment-augment": [],
    "item-augment": [],
  };
  for (const entry of combos.values()) {
    if (entry.games < minGames) continue;
    const lo = Math.floor(entry.code / PICK_PAIR_BASE);
    const hi = entry.code - lo * PICK_PAIR_BASE;
    byCategory[entry.category].push([
      lo,
      hi,
      entry.games,
      entry.top1Wins,
      entry.top3Wins,
      entry.placementSum,
    ]);
  }

  // Same tier score as everywhere else, used here purely to pick the best
  // combos per category — computeTiers is called again on just the ones kept
  // wherever they're displayed, so the S–D bands shown reflect the real gaps
  // in what's actually on screen, not the full unfiltered pool.
  //
  // Le dénominateur n'entre pas ici : le score ne regarde que parties, placement
  // moyen et taux de top, jamais le playRate. Chaque appelant appliquera le sien
  // au dépaquetage.
  for (const category of Object.keys(byCategory) as ComboCategory[]) {
    const keyed = byCategory[category].map((packed, i) => {
      const [, , games, top1Wins, top3Wins, placementSum] = packed;
      return { key: String(i), packed, ...toStat({ games, top1Wins, top3Wins, placementSum }, 1) };
    });
    const tierMap = computeTiers(keyed);
    keyed.sort((x, y) => tierMap.get(y.key)!.score - tierMap.get(x.key)!.score);
    byCategory[category] = keyed.slice(0, maxPerCategory).map((k) => k.packed);
  }

  return byCategory;
}

export async function getComboStats(
  itemCategoryOf: ItemCategoryLookup
): Promise<{ totalMatches: number; byCategory: Record<ComboCategory, ComboStat[]> }> {
  const rows = await fetchAllParticipants();
  const totalMatches = matchCountOf(rows);
  const denominator = totalMatches * PARTICIPANTS_PER_MATCH;
  const packed = computeCombos(rows, itemCategoryOf, COMBO_MIN_GAMES, COMBO_MAX_ROWS);
  const byCategory = Object.fromEntries(
    Object.entries(packed).map(([category, list]) => [
      category,
      list.map((combo) => unpackCombo(combo, denominator)),
    ]),
  ) as Record<ComboCategory, ComboStat[]>;
  return { totalMatches, byCategory };
}
