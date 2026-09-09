import { supabaseAdmin } from "@/lib/supabase";

export type ParticipantRow = {
  match_id: string;
  puuid: string;
  riot_id: string;
  champion: string;
  placement: number;
  augments: number[];
  items: number[];
};

// Arena is 6 teams of 3 — top half (placement <= 3) is what we surface as
// "% Top 3", matching what Riot's own `win` boolean reflected in the old
// 2v2 format.
export const TOP3_PLACEMENT_THRESHOLD = 3;

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

export async function fetchAllParticipants(): Promise<ParticipantRow[]> {
  if (!supabaseAdmin) return [];

  const allRows: ParticipantRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabaseAdmin
      .from("match_participants")
      .select("match_id, puuid, riot_id, champion, placement, augments, items")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return allRows;
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
    top3Rate: s.top3Wins / s.games,
    top1Rate: s.top1Wins / s.games,
    avgPlacement: s.placementSum / s.games,
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
    .map(([champion, s]) => ({ champion, ...toStat(s, totalMatches) }))
    .sort((a, b) => b.top3Rate - a.top3Rate);
  return { totalMatches, champions };
}

export async function getItemStats() {
  const rows = await fetchAllParticipants();
  const totalMatches = countMatches(rows);
  const byItem = new Map<number, Accumulator>();
  for (const r of rows) {
    for (const itemId of r.items) accumulate(byItem, itemId, r.placement);
  }
  const items = Array.from(byItem.entries())
    .map(([itemId, s]) => ({ itemId, ...toStat(s, totalMatches) }))
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
    .map(([augmentId, s]) => ({ augmentId, ...toStat(s, totalMatches) }))
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

export type ChampionAugmentStat = { augmentId: number } & Stat;
export type ChampionItemSlotStat = { itemId: number } & Stat;
export type ChampionItemSlot = { slot: number; items: ChampionItemSlotStat[] };

export type ChampionDetail = {
  champion: string; // canonical id as stored (Riot casing) — caller resolves display info
  totalMatches: number;
} & Stat & {
    augmentsByRarity: Record<"silver" | "gold" | "prismatic", ChampionAugmentStat[]>;
    itemBuild: ChampionItemSlot[];
  };

/**
 * Everything about one champion: overall stats (scoped to all tracked matches,
 * so playRate = pick rate), best augments (scoped to this champion's own
 * games, so playRate = how often that augment shows up when this champion is
 * played), and a per-slot item build (see BUILD_SLOT_COUNT comment above).
 */
export async function getChampionDetail(
  championIdLower: string,
  rarityOf: (augmentId: number) => "silver" | "gold" | "prismatic" | undefined
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

  // Augments used on this champion, split by rarity, top 5 each by % top 3.
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
    augmentsByRarity[rarity].sort((a, b) => b.top3Rate - a.top3Rate);
    augmentsByRarity[rarity] = augmentsByRarity[rarity].slice(0, 5);
  }

  // Item build: for each build-order position, which items show up there most
  // often, most-frequent first.
  const bySlot: Map<number, Accumulator>[] = Array.from({ length: BUILD_SLOT_COUNT }, () => new Map());
  for (const r of champRows) {
    for (let slot = 0; slot < Math.min(BUILD_SLOT_COUNT, r.items.length); slot++) {
      accumulate(bySlot[slot], r.items[slot], r.placement);
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

  return {
    champion: champRows[0].champion,
    totalMatches,
    ...toStat(championAcc, totalMatches),
    augmentsByRarity,
    itemBuild,
  };
}
