export type Tier = "S" | "A" | "B" | "C" | "D";

export const TIER_ORDER: Tier[] = ["S", "A", "B", "C", "D"];

/**
 * Assigns a fixed S/A/B/C/D tier to every row, independent of whichever sort
 * the user currently has selected.
 *
 * Pipeline:
 * 1. Shrinkage — avg placement, %top1 and %top3 are each pulled toward this
 *    batch's own mean, proportionally to how few games back them up (a
 *    Bayesian/"weighted rating" fix, same idea as IMDB's weighted score), so
 *    a 2-game 100%-top1 outlier doesn't outrank a proven 500-game pick.
 * 2. Base score — the shrunk metrics are min-max normalized to [0, 1] and
 *    combined as 60% avg placement + 20% %top1 + 20% %top3: avg placement
 *    dominates, the two rates split the rest evenly.
 * 3. Games bonus — on top of that, up to +0.2 is added back in based on
 *    log(games), normalized the same way. This is a real, capped bonus for
 *    "proven at scale, adapts to lots of situations" — but it can only push
 *    an already-decent pick up, never rescue a genuinely bad one on volume
 *    alone.
 * 4. Tiering — instead of slicing the sorted list into 5 forced 20% bands
 *    (which spreads near-identical rows across several tiers whenever many
 *    of them cluster together), rows are first grouped by the real gaps in
 *    this batch's score distribution (1D k-means, then merging groups back
 *    together wherever there's no real separation), and each surviving
 *    group is labeled by how many standard deviations its mean sits from
 *    this batch's average score — which reproduces the old even-fifths
 *    shape when the data is a smooth continuous spread, but collapses to
 *    fewer, wider tiers around a real gap or outlier.
 */
export type TierInfo = { tier: Tier; score: number };

type TierableRow = {
  key: string;
  games: number;
  top3Rate: number;
  top1Rate: number;
  avgPlacement: number;
};

const AVG_PLACEMENT_WEIGHT = 0.6;
const TOP1_WEIGHT = 0.2;
const TOP3_WEIGHT = 0.2;

// Max share of the final score that sample size alone can contribute.
const GAMES_BONUS_CAP = 0.2;

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Pulls `value` toward `populationMean` when `games` is small relative to
// `k`, and leaves it ~untouched once `games` comfortably exceeds `k`.
function shrink(value: number, games: number, populationMean: number, k: number): number {
  return (games * value + k * populationMean) / (games + k);
}

// Min-max normalize to [0, 1]. A perfectly flat input (every row identical)
// maps everyone to 0.5 rather than dividing by zero.
function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-12) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

type Group = { mean: number; startIdx: number; endIdx: number };

// Adjacent groups (in ascending score order) merge together whenever they're
// closer than this fraction of the full batch's score range — i.e. a cluster
// boundary only survives if it corresponds to a real gap, not a slice
// k-means was forced to cut through an otherwise uniform blob.
const MERGE_THRESHOLD_RATIO = 0.08;

function mergeAdjacentGroups(groups: Group[], scores: number[], thresholdAbs: number): Group[] {
  const merged = [...groups];
  let i = 0;
  while (i < merged.length - 1) {
    if (merged[i + 1].mean - merged[i].mean < thresholdAbs) {
      const a = merged[i];
      const b = merged[i + 1];
      const combinedScores = scores.slice(a.startIdx, b.endIdx + 1);
      merged.splice(i, 2, { mean: mean(combinedScores), startIdx: a.startIdx, endIdx: b.endIdx });
      i = Math.max(0, i - 1);
    } else {
      i++;
    }
  }
  return merged;
}

// Groups `scores` into up to 5 clusters and returns, per row, a tier index
// (0 = best / S, up to 4 = worst / D) — so tier boundaries land on the
// actual gaps in this batch's score distribution instead of forcing even
// 20% bands (or, just as artificially, always exactly 5 clusters)
// regardless of how bunched-up the scores really are.
//
// Pass 1 runs 1D k-means (Lloyd's algorithm) with k = min(5, n) to get a
// starting partition. Pass 2 walks the resulting groups in score order and
// merges any pair whose means are within MERGE_THRESHOLD_RATIO of the full
// range — collapsing k-means' forced cuts back together wherever there's no
// real separation (e.g. 15 near-identical items that k-means alone would
// have sliced into 3-4 tiers). A batch with one real outlier and an
// otherwise flat blob ends up with 2 tiers, not 5; a batch with a genuinely
// smooth spread keeps close to 5.
function clusterIntoTiers(scores: number[]): number[] {
  const n = scores.length;
  const order = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const sorted = order.map((i) => scores[i]);

  const range = sorted[n - 1] - sorted[0];
  let groups: Group[];

  if (n === 1 || range < 1e-9) {
    // Single row, or every row scored identically: nothing to separate.
    groups = [{ mean: mean(sorted), startIdx: 0, endIdx: n - 1 }];
  } else {
    const k = Math.min(TIER_ORDER.length, n);
    let centroids = Array.from({ length: k }, (_, c) => sorted[Math.floor(((c + 0.5) * n) / k)]);
    let assignment = new Array(n).fill(-1);

    for (let iter = 0; iter < 50; iter++) {
      const next = sorted.map((v) => {
        let best = 0;
        let bestDist = Infinity;
        for (let c = 0; c < k; c++) {
          const d = Math.abs(v - centroids[c]);
          if (d < bestDist) {
            bestDist = d;
            best = c;
          }
        }
        return best;
      });
      const converged = next.every((v, i) => v === assignment[i]);
      assignment = next;
      if (converged) break;
      centroids = centroids.map((old, c) => {
        const members = sorted.filter((_, i) => assignment[i] === c);
        return members.length > 0 ? mean(members) : old;
      });
    }

    // 1D nearest-centroid assignment always yields contiguous runs once
    // sorted, so run-length-encoding `assignment` recovers the groups
    // regardless of the arbitrary numeric cluster ids k-means produced.
    groups = [];
    for (let i = 0; i < n; i++) {
      const last = groups[groups.length - 1];
      if (last && assignment[i] === assignment[i - 1]) {
        last.endIdx = i;
      } else {
        groups.push({ mean: sorted[i], startIdx: i, endIdx: i });
      }
    }
    groups = groups.map((g) => ({ ...g, mean: mean(sorted.slice(g.startIdx, g.endIdx + 1)) }));
    groups = mergeAdjacentGroups(groups, sorted, MERGE_THRESHOLD_RATIO * range);
  }

  // Label each group by how many standard deviations its mean sits from the
  // batch's own average score — not by how many groups happened to survive
  // merging (ordinal labeling would mislabel a single bad outlier as "A"
  // just because it's the 2nd group), and not by a fixed fraction of the
  // full min-max range either (real, fairly continuous data — e.g. ~170
  // champions with no huge outlier — rarely has *anyone* within 80% of the
  // full best-to-worst spread, so that scheme left S empty in practice).
  // The cutoffs below (±0.84σ, ±0.25σ) are the z-scores that bound even
  // 20% bands under a normal distribution — i.e. this reproduces the old
  // "quintiles" shape when the data actually is a smooth continuous spread,
  // while still collapsing to fewer, wider tiers around real gaps/outliers.
  const scoreMean = mean(sorted);
  const scoreStd = Math.sqrt(mean(sorted.map((v) => (v - scoreMean) ** 2)));
  const result = new Array(n);
  groups.forEach((g) => {
    const z = scoreStd < 1e-9 ? 0 : (g.mean - scoreMean) / scoreStd;
    let tierIndex: number;
    if (z >= 0.84) tierIndex = 0;
    else if (z >= 0.25) tierIndex = 1;
    else if (z >= -0.25) tierIndex = 2;
    else if (z >= -0.84) tierIndex = 3;
    else tierIndex = 4;
    for (let sortedIndex = g.startIdx; sortedIndex <= g.endIdx; sortedIndex++) {
      result[order[sortedIndex]] = tierIndex;
    }
  });
  return result;
}

export function computeTiers<T extends TierableRow>(rows: T[]): Map<string, TierInfo> {
  const tierMap = new Map<string, TierInfo>();
  if (rows.length === 0) return tierMap;

  // Confidence anchor for the shrinkage step: how many games count as "a
  // solid sample" is relative to this batch, not a hardcoded number — so it
  // self-calibrates whether `rows` is every item site-wide or just one
  // champion's own games.
  const k = Math.max(1, median(rows.map((r) => r.games)));

  const meanPlacement = mean(rows.map((r) => r.avgPlacement));
  const meanTop1 = mean(rows.map((r) => r.top1Rate));
  const meanTop3 = mean(rows.map((r) => r.top3Rate));

  const shrunkPlacement = rows.map((r) => shrink(r.avgPlacement, r.games, meanPlacement, k));
  const shrunkTop1 = rows.map((r) => shrink(r.top1Rate, r.games, meanTop1, k));
  const shrunkTop3 = rows.map((r) => shrink(r.top3Rate, r.games, meanTop3, k));
  const logGames = rows.map((r) => Math.log(1 + r.games));

  // Lower avg placement is better, so invert before normalizing — every
  // other normalized metric already has "higher is better".
  const normPlacement = normalize(shrunkPlacement.map((v) => -v));
  const normTop1 = normalize(shrunkTop1);
  const normTop3 = normalize(shrunkTop3);
  const normGames = normalize(logGames);

  const scored = rows.map((r, i) => {
    const base =
      normPlacement[i] * AVG_PLACEMENT_WEIGHT + normTop1[i] * TOP1_WEIGHT + normTop3[i] * TOP3_WEIGHT;
    const gamesBonus = normGames[i] * GAMES_BONUS_CAP;
    return { key: r.key, score: base + gamesBonus };
  });

  const tierIndices = clusterIntoTiers(scored.map((s) => s.score));
  scored.forEach((s, i) => tierMap.set(s.key, { tier: TIER_ORDER[tierIndices[i]], score: s.score }));

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
  { text: string; bg: string; border: string; glow: string; hex: string }
> = {
  S: {
    text: "text-[#F2B640]",
    bg: "bg-[#F2B640]/[0.14]",
    border: "border-[#F2B640]/40",
    glow: "shadow-[0_0_16px_-4px_rgba(242,182,64,0.45)]",
    hex: "#F2B640",
  },
  A: {
    text: "text-[#35D0E8]",
    bg: "bg-[#35D0E8]/[0.12]",
    border: "border-[#35D0E8]/30",
    glow: "",
    hex: "#35D0E8",
  },
  B: {
    text: "text-[#7C8CF8]",
    bg: "bg-[#7C8CF8]/10",
    border: "border-[#7C8CF8]/25",
    glow: "",
    hex: "#7C8CF8",
  },
  C: {
    text: "text-[#8792A8]",
    bg: "bg-[#8792A8]/[0.08]",
    border: "border-[#8792A8]/20",
    glow: "",
    hex: "#8792A8",
  },
  D: {
    text: "text-[#5A6172]",
    bg: "bg-[#5A6172]/[0.06]",
    border: "border-[#5A6172]/[0.16]",
    glow: "",
    hex: "#5A6172",
  },
};
