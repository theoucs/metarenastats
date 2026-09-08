export type Tier = "S" | "A" | "B" | "C" | "D";

export const TIER_ORDER: Tier[] = ["S", "A", "B", "C", "D"];

/**
 * Assigns a fixed S/A/B/C/D tier to every row, independent of whichever sort
 * the user currently has selected. Each row gets a combined score: the
 * average of its rank position across four metrics — games played (more is
 * better, so low-sample flukes don't outrank proven performers), avg
 * placement, % top 1, and % top 3. Rows are then sorted by that combined
 * score and split into 5 equal-size bands (quintiles) — S is the
 * best-ranked 20%, D the worst-ranked 20%, regardless of which single
 * metric you're currently viewing.
 */
export type TierInfo = { tier: Tier; score: number };

type TierableRow = {
  key: string;
  games: number;
  top3Rate: number;
  top1Rate: number;
  avgPlacement: number;
};

function rankBy<T extends { key: string }>(rows: T[], compare: (a: T, b: T) => number) {
  const rank = new Map<string, number>();
  [...rows].sort(compare).forEach((r, i) => rank.set(r.key, i + 1));
  return rank;
}

export function computeTiers<T extends TierableRow>(rows: T[]): Map<string, TierInfo> {
  const n = rows.length;
  const tierMap = new Map<string, TierInfo>();
  if (n === 0) return tierMap;

  const gamesRank = rankBy(rows, (a, b) => b.games - a.games);
  const placementRank = rankBy(rows, (a, b) => a.avgPlacement - b.avgPlacement);
  const top1Rank = rankBy(rows, (a, b) => b.top1Rate - a.top1Rate);
  const top3Rank = rankBy(rows, (a, b) => b.top3Rate - a.top3Rate);

  const byCombinedScore = rows
    .map((r) => ({
      key: r.key,
      score:
        (gamesRank.get(r.key)! +
          placementRank.get(r.key)! +
          top1Rank.get(r.key)! +
          top3Rank.get(r.key)!) /
        4,
    }))
    .sort((a, b) => a.score - b.score);

  byCombinedScore.forEach((entry, i) => {
    const percentile = i / n;
    let tier: Tier;
    if (percentile < 0.2) tier = "S";
    else if (percentile < 0.4) tier = "A";
    else if (percentile < 0.6) tier = "B";
    else if (percentile < 0.8) tier = "C";
    else tier = "D";
    tierMap.set(entry.key, { tier, score: entry.score });
  });

  return tierMap;
}

export const TIER_STYLES: Record<
  Tier,
  { text: string; bg: string; border: string; glow: string }
> = {
  S: {
    text: "text-amber-300",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    glow: "shadow-[0_0_20px_-4px_rgba(251,191,36,0.35)]",
  },
  A: {
    text: "text-violet-300",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    glow: "shadow-[0_0_20px_-4px_rgba(167,139,250,0.3)]",
  },
  B: {
    text: "text-blue-300",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    glow: "",
  },
  C: {
    text: "text-emerald-300",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    glow: "",
  },
  D: {
    text: "text-zinc-400",
    bg: "bg-zinc-500/10",
    border: "border-zinc-700/50",
    glow: "",
  },
};
