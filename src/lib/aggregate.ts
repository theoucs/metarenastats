import { supabaseAdmin } from "@/lib/supabase";

export type ParticipantRow = {
  puuid: string;
  riot_id: string;
  champion: string;
  placement: number;
  augments: number[];
  items: number[];
};

// Arena is 6 teams of 3 — top half (placement <= 3) counts as a "win",
// matching what Riot's own `win` boolean reflected in the old 2v2 format.
export const WIN_PLACEMENT_THRESHOLD = 3;

export async function fetchAllParticipants(): Promise<ParticipantRow[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("match_participants")
    .select("puuid, riot_id, champion, placement, augments, items")
    .limit(5000);
  if (error) throw error;
  return data ?? [];
}

type Stat = { games: number; winRate: number; avgPlacement: number };

function toStat(s: { games: number; wins: number; placementSum: number }): Stat {
  return {
    games: s.games,
    winRate: s.wins / s.games,
    avgPlacement: s.placementSum / s.games,
  };
}

export async function getChampionStats() {
  const rows = await fetchAllParticipants();
  const byChampion = new Map<string, { games: number; wins: number; placementSum: number }>();
  for (const r of rows) {
    const entry = byChampion.get(r.champion) ?? { games: 0, wins: 0, placementSum: 0 };
    entry.games += 1;
    entry.placementSum += r.placement;
    if (r.placement <= WIN_PLACEMENT_THRESHOLD) entry.wins += 1;
    byChampion.set(r.champion, entry);
  }
  const champions = Array.from(byChampion.entries())
    .map(([champion, s]) => ({ champion, ...toStat(s) }))
    .sort((a, b) => b.winRate - a.winRate);
  return { totalGames: rows.length, champions };
}

export async function getItemStats() {
  const rows = await fetchAllParticipants();
  const byItem = new Map<number, { games: number; wins: number; placementSum: number }>();
  for (const r of rows) {
    for (const itemId of r.items) {
      const entry = byItem.get(itemId) ?? { games: 0, wins: 0, placementSum: 0 };
      entry.games += 1;
      entry.placementSum += r.placement;
      if (r.placement <= WIN_PLACEMENT_THRESHOLD) entry.wins += 1;
      byItem.set(itemId, entry);
    }
  }
  const items = Array.from(byItem.entries())
    .map(([itemId, s]) => ({ itemId, ...toStat(s) }))
    .sort((a, b) => b.winRate - a.winRate);
  return { totalGames: rows.length, items };
}

export async function getAugmentStats() {
  const rows = await fetchAllParticipants();
  const byAugment = new Map<number, { games: number; wins: number; placementSum: number }>();
  for (const r of rows) {
    for (const augmentId of r.augments) {
      const entry = byAugment.get(augmentId) ?? { games: 0, wins: 0, placementSum: 0 };
      entry.games += 1;
      entry.placementSum += r.placement;
      if (r.placement <= WIN_PLACEMENT_THRESHOLD) entry.wins += 1;
      byAugment.set(augmentId, entry);
    }
  }
  const augments = Array.from(byAugment.entries())
    .map(([augmentId, s]) => ({ augmentId, ...toStat(s) }))
    .sort((a, b) => b.winRate - a.winRate);
  return { totalGames: rows.length, augments };
}

export async function getLeaderboardStats() {
  const rows = await fetchAllParticipants();
  const byPlayer = new Map<
    string,
    { riotId: string; games: number; wins: number; placementSum: number }
  >();
  for (const r of rows) {
    const entry = byPlayer.get(r.puuid) ?? {
      riotId: r.riot_id,
      games: 0,
      wins: 0,
      placementSum: 0,
    };
    entry.riotId = r.riot_id;
    entry.games += 1;
    entry.placementSum += r.placement;
    if (r.placement <= WIN_PLACEMENT_THRESHOLD) entry.wins += 1;
    byPlayer.set(r.puuid, entry);
  }
  const players = Array.from(byPlayer.entries())
    .map(([puuid, s]) => ({ puuid, riotId: s.riotId, ...toStat(s) }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
  return { totalGames: rows.length, players };
}
