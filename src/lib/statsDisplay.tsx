// Plain (non-"use client") helpers shared between the client-side StatsTable
// and server-rendered pages like the champion detail page — functions and
// components exported from a "use client" file can't be called from a server
// component, only rendered as JSX, so these live outside StatsTable.tsx.

export type EntityRarity = "silver" | "gold" | "prismatic";

// % Top 3 averages ~50% (3 of 6 teams) — thresholds centered on that.
// Reserved colors: this is the only place green/red should ever appear.
export function top3Color(rate: number) {
  if (rate >= 0.55) return "text-stat-good";
  if (rate >= 0.4) return "text-secondary";
  return "text-stat-bad";
}

// % Top 1 averages ~16.7% (1 of 6 teams) — a much lower baseline, needs its
// own thresholds or almost everything reads as "bad" red.
export function top1Color(rate: number) {
  if (rate >= 0.25) return "text-stat-good";
  if (rate >= 0.1) return "text-secondary";
  return "text-stat-bad";
}

// Matches the in-game augment rarity frame colors — silver/gold border, a
// holo gradient ring for prismatic (plain items/champions get a neutral
// border). silver/gold are nudged toward the game's metallic frame hue
// (--rarity-silver/--rarity-gold); prismatic uses the real in-game gradient
// sampled from the actual frame asset, not an invented one — see
// docs/design-refresh-plan.md §3.1.1.
const RARITY_BORDER: Record<string, string> = {
  silver: "border-2 border-[color:var(--rarity-silver)]/70",
  gold: "border-2 border-[color:var(--rarity-gold)]/90",
};

export function StatPill({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <div className="rounded-[10px] border border-subtle bg-raised px-4 py-2.5 text-center shadow-[var(--elev-1)]">
      <div className="text-micro uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-display text-display font-semibold ${colorClass ?? "text-primary"}`}>
        {value}
      </div>
    </div>
  );
}

export function MiniStat({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wide text-muted">{label}</div>
      <div className={`font-mono text-xs [font-variant-numeric:tabular-nums] ${colorClass ?? "text-secondary"}`}>
        {value}
      </div>
    </div>
  );
}

export function EntityIcon({ iconUrl, rarity }: { iconUrl: string; rarity?: EntityRarity }) {
  if (rarity === "prismatic") {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md p-[2px]"
        style={{ backgroundImage: "var(--prism-frame)" }}
      >
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
        rarity ? RARITY_BORDER[rarity] : "border border-subtle"
      }`}
    />
  );
}
