export type Tier = "S" | "A" | "B" | "C" | "D";

export const TIER_ORDER: Tier[] = ["S", "A", "B", "C", "D"];

// Win rate here is "top-3-of-6-teams" (see WIN_PLACEMENT_THRESHOLD), so the
// pool average sits around 50% — bands are centered on that.
export function getTier(winRate: number): Tier {
  if (winRate >= 0.65) return "S";
  if (winRate >= 0.55) return "A";
  if (winRate >= 0.45) return "B";
  if (winRate >= 0.35) return "C";
  return "D";
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
