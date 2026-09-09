// Plain (non-"use client") helpers shared between the client-side StatsTable
// and server-rendered pages like the champion detail page — functions and
// components exported from a "use client" file can't be called from a server
// component, only rendered as JSX, so these live outside StatsTable.tsx.

export type EntityRarity = "silver" | "gold" | "prismatic";

// % Top 3 averages ~50% (3 of 6 teams) — thresholds centered on that.
export function top3Color(rate: number) {
  if (rate >= 0.55) return "text-emerald-400";
  if (rate >= 0.4) return "text-zinc-200";
  return "text-red-400";
}

// % Top 1 averages ~16.7% (1 of 6 teams) — a much lower baseline, needs its
// own thresholds or almost everything reads as "bad" red.
export function top1Color(rate: number) {
  if (rate >= 0.25) return "text-emerald-400";
  if (rate >= 0.1) return "text-zinc-200";
  return "text-red-400";
}

// Matches the in-game augment rarity frame colors — silver/gold border, a
// holo gradient ring for prismatic (plain items/champions get a neutral border).
const RARITY_BORDER: Record<string, string> = {
  silver: "border-2 border-slate-300/70",
  gold: "border-2 border-amber-400/90",
};

export function EntityIcon({ iconUrl, rarity }: { iconUrl: string; rarity?: EntityRarity }) {
  if (rarity === "prismatic") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-fuchsia-400 via-purple-400 to-cyan-300 p-[2px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconUrl} alt="" className="h-full w-full rounded-[4px] object-cover" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl}
      alt=""
      className={`h-7 w-7 shrink-0 rounded-md object-cover ${
        rarity ? RARITY_BORDER[rarity] : "border border-zinc-800"
      }`}
    />
  );
}
