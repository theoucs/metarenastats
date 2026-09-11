import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import { computeTiers } from "@/lib/tiers";

export type ParticipantRow = {
  match_id: string;
  puuid: string;
  riot_id: string;
  subteam_id: number;
  champion: string;
  placement: number;
  augments: number[];
  items: number[];
};

// The "Anvil Voucher" family (early-game stat-anvil choice screens) get
// consumed into a real Prismatic/Legendary/Excluded item within a minute or
// two of normal play — a voucher still sitting in a *final* inventory means
// that player never played the game (AFK/disconnected). Riot still records a
// placement for their team in that case, but it's not a real result: the
// team is essentially playing 2v3 (or worse) and the placement reflects that
// handicap, not genuine performance — so the whole team is dropped from
// every stat for that one match (see fetchAllParticipants).
const AFK_VOUCHER_ITEM_IDS = new Set([220008, 220009, 220010, 220011]);

// Arena is 6 teams of 3 — top half (placement <= 3) is what we surface as
// "% Top 3", matching what Riot's own `win` boolean reflected in the old
// 2v2 format.
export const TOP3_PLACEMENT_THRESHOLD = 3;

// 6 teams of 3 — used to turn a match count into a participant-slot count for
// "% Played" on champions/items/augments (each of the 18 slots independently
// picks a champion / can include a given item or augment in its build, so the
// pick-rate denominator is matches × 18, not matches).
const PARTICIPANTS_PER_MATCH = 18;

// Build-order slots we track per champion (see getChampionDetail) — `items`
// preserves Riot's item0..item6 order with empty slots compacted out, which
// approximates purchase order well enough without the Match Timeline API.
const BUILD_SLOT_COUNT = 6;
const ALTS_PER_SLOT = 3; // 1 primary + 2 alternates

// Supabase/PostgREST caps every response at 1000 rows server-side (the "Max Rows"
// project setting) regardless of the .limit() a client asks for — paginate with
// .range() to actually fetch everything. Capped at 30 pages (30k rows) as a safety
// net; past that, this should become a real SQL aggregation instead of pulling
// every row into app memory.
const PAGE_SIZE = 1000;
const MAX_PAGES = 30;

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
export const fetchAllParticipants = cache(async function fetchAllParticipants(): Promise<
  ParticipantRow[]
> {
  if (!supabaseAdmin) return [];

  const allRows: ParticipantRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabaseAdmin
      .from("match_participants")
      .select("match_id, puuid, riot_id, subteam_id, champion, placement, augments, items")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return dropAfkTeams(allRows);
});

// Drops every row belonging to a (match, subteam) where at least one
// teammate still had an Anvil/Bravery Voucher at game end — see
// AFK_VOUCHER_ITEM_IDS.
function dropAfkTeams(rows: ParticipantRow[]): ParticipantRow[] {
  const afkTeams = new Set<string>();
  for (const r of rows) {
    if (r.items.some((id) => AFK_VOUCHER_ITEM_IDS.has(id))) {
      afkTeams.add(`${r.match_id}:${r.subteam_id}`);
    }
  }
  if (afkTeams.size === 0) return rows;
  return rows.filter((r) => !afkTeams.has(`${r.match_id}:${r.subteam_id}`));
}

// Rows are per-participant (18 per match, since we save all 6 teams) — the
// number of *matches* tracked is the count of distinct match IDs, not rows.
function countMatches(rows: ParticipantRow[]): number {
  return new Set(rows.map((r) => r.match_id)).size;
}

export async function getSiteStats() {
  const rows = await fetchAllParticipants();
  return {
    totalMatches: countMatches(rows),
    totalChampions: new Set(rows.map((r) => r.champion)).size,
    totalPlayers: new Set(rows.map((r) => r.puuid)).size,
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

export async function getLeaderboardStats() {
  const rows = await fetchAllParticipants();
  const totalMatches = countMatches(rows);
  const byPlayer = new Map<string, Accumulator & { riotId: string }>();
  for (const r of rows) {
    const entry = byPlayer.get(r.puuid) ?? {
      riotId: r.riot_id,
      games: 0,
      top3Wins: 0,
      top1Wins: 0,
      placementSum: 0,
    };
    entry.riotId = r.riot_id;
    entry.games += 1;
    entry.placementSum += r.placement;
    if (r.placement <= TOP3_PLACEMENT_THRESHOLD) entry.top3Wins += 1;
    if (r.placement === 1) entry.top1Wins += 1;
    byPlayer.set(r.puuid, entry);
  }
  const players = Array.from(byPlayer.entries())
    .map(([puuid, s]) => ({ puuid, riotId: s.riotId, ...toStat(s, totalMatches) }))
    .sort((a, b) => b.top3Rate - a.top3Rate || b.games - a.games);
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

/** Everything about one player scoped to their own games (all matches we've
 * ever stored involving this puuid, not just the ones from the most recent
 * search) — powers the player profile page. */
export async function getPlayerProfile(puuid: string): Promise<PlayerProfile> {
  const rows = await fetchAllParticipants();
  const playerRows = rows.filter((r) => r.puuid === puuid);
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
  const bySlot: Map<number, Accumulator>[] = Array.from({ length: BUILD_SLOT_COUNT }, () => new Map());
  for (const r of champRows) {
    const buildableItems = r.items.filter((id) => itemCategoryOf(id) !== "excluded");
    for (let slot = 0; slot < Math.min(BUILD_SLOT_COUNT, buildableItems.length); slot++) {
      accumulate(bySlot[slot], buildableItems[slot], r.placement);
    }
  }
  const itemBuild: ChampionItemSlot[] = bySlot
    .map((slotMap, i) => {
      const items = Array.from(slotMap.entries())
        .map(([itemId, s]) => ({ itemId, ...toStat(s, champGames) }))
        .sort((a, b) => b.games - a.games)
        .slice(0, ALTS_PER_SLOT);
      return { slot: i + 1, items };
    })
    .filter((s) => s.items.length > 0);

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
  /** % Top 3 across every pick made in each slot — what `swing` corrects for. */
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
  const slotTotals: Accumulator[] = Array.from({ length: TIMING_SLOTS }, () => ({
    games: 0,
    top3Wins: 0,
    top1Wins: 0,
    placementSum: 0,
  }));

  for (const row of rows) {
    row.augments.slice(0, TIMING_SLOTS).forEach((augmentId, index) => {
      accumulate(perSlot[index], augmentId, row.placement);
      const total = slotTotals[index];
      total.games += 1;
      total.placementSum += row.placement;
      if (row.placement <= TOP3_PLACEMENT_THRESHOLD) total.top3Wins += 1;
    });
  }

  const baselines = slotTotals.map((t) => (t.games > 0 ? t.top3Wins / t.games : 0));

  const eligible = Array.from(perSlot[0].keys()).filter((id) =>
    perSlot.every((slot) => (slot.get(id)?.games ?? 0) >= TIMING_MIN_PICKS)
  );

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
