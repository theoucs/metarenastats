export type Tier = "S" | "A" | "B" | "C" | "D";

export const TIER_ORDER: Tier[] = ["S", "A", "B", "C", "D"];

/**
 * Assigns a fixed S/A/B/C/D tier to every row, independent of whichever sort
 * the user currently has selected. Each row gets a combined score: the
 * weighted average of its rank position across four metrics — games played
 * (more is better, so low-sample flukes don't outrank proven performers, and
 * weighted 1.5x so sample size matters more than the other three), avg
 * placement, % top 1, and % top 3. Rows are then sorted by that combined
 * score and split into 5 equal-size bands (quintiles) — S is the
 * best-ranked 20%, D the worst-ranked 20%, regardless of which single
 * metric you're currently viewing.
 */
export type TierInfo = { tier: Tier; score: number };

const GAMES_WEIGHT = 1.5;
const OTHER_WEIGHT = 1;
const TOTAL_WEIGHT = GAMES_WEIGHT + OTHER_WEIGHT * 3;

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
        (gamesRank.get(r.key)! * GAMES_WEIGHT +
          placementRank.get(r.key)! * OTHER_WEIGHT +
          top1Rank.get(r.key)! * OTHER_WEIGHT +
          top3Rank.get(r.key)! * OTHER_WEIGHT) /
        TOTAL_WEIGHT,
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

// A deliberate descent — gold -> cyan -> indigo -> slate -> grey — that still
// reads in greyscale, and (unlike the previous ramp) never uses green: green
// means "good stat" in the % Top 1 / % Top 3 columns right next to this badge,
// so a green tier used to read as "good" regardless of which letter it was.
// The tier-A cyan intentionally matches --accent (the interactive color) —
// this is a closed 5-step scale always shown as a fixed-width badge in its own
// column, never next to a link, so there's no real ambiguity. Don't invent a
// 6th hue to "fix" this; it would break the descent instead.
export const TIER_STYLES: Record<
  Tier,
  { text: string; bg: string; border: string; glow: string }
> = {
  S: {
    text: "text-[#F2B640]",
    bg: "bg-[#F2B640]/[0.14]",
    border: "border-[#F2B640]/40",
    glow: "shadow-[0_0_16px_-4px_rgba(242,182,64,0.45)]",
  },
  A: {
    text: "text-[#35D0E8]",
    bg: "bg-[#35D0E8]/[0.12]",
    border: "border-[#35D0E8]/30",
    glow: "",
  },
  B: {
    text: "text-[#7C8CF8]",
    bg: "bg-[#7C8CF8]/10",
    border: "border-[#7C8CF8]/25",
    glow: "",
  },
  C: {
    text: "text-[#8792A8]",
    bg: "bg-[#8792A8]/[0.08]",
    border: "border-[#8792A8]/20",
    glow: "",
  },
  D: {
    text: "text-[#5A6172]",
    bg: "bg-[#5A6172]/[0.06]",
    border: "border-[#5A6172]/[0.16]",
    glow: "",
  },
};
