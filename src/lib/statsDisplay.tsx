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

// % Top 1 averages 16.7% (1 of 6 teams) — a much lower baseline than % Top 3,
// so it needs its own thresholds or almost everything reads as "bad" red.
//
// The band sits roughly symmetrically around that baseline: +3.3pp to clear
// into green, -3.7pp to drop into red. The previous 25% green cutoff was most
// of a doubling above the baseline, which almost nothing reaches once a
// champion has enough games for its rate to stop swinging.
export function top1Color(rate: number) {
  if (rate >= 0.2) return "text-stat-good";
  if (rate >= 0.13) return "text-secondary";
  return "text-stat-bad";
}

// Avg placement over 6 teams — the expected value is 3.5, so the band sits
// around that: -0.3 to clear into green, +0.2 to drop into red. Comparisons are
// inverted relative to top3Color/top1Color because here *lower* is better.
// Same reserved-color rule: green/red only ever mean "this number is good/bad".
export function avgPlacementColor(avg: number) {
  if (avg <= 3.2) return "text-stat-good";
  if (avg <= 3.7) return "text-secondary";
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
  emphasis = false,
}: {
  label: string;
  value: string;
  colorClass?: string;
  /** The one metric that outranks the others in this group — always Avg
   * Placement (see docs/design-audit-plan.md, "Décision actée"). Five pills at
   * the same weight meant no pill carried anything. */
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-2.5 text-center ${
        emphasis
          ? "border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] shadow-[var(--elev-2)]"
          : "border-subtle bg-raised shadow-[var(--elev-1)]"
      }`}
    >
      <div className="text-micro uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`mt-1 font-display font-semibold ${
          emphasis ? "text-display sm:text-display-lg" : "text-h1"
        } ${colorClass ?? "text-primary"}`}
      >
        {value}
      </div>
    </div>
  );
}

/** The five column labels every stat row under a MiniStatRow header repeats.
 *  Written once per column instead of once per card — on the champion page
 *  that was the same five words rendered ~75 times. */
export const MINI_STAT_LABELS = ["Avg", "Top 1", "Top 3", "Games", "Played"] as const;

export function MiniStatHeader() {
  return (
    <div className="grid grid-cols-5 gap-1 px-3 text-center text-micro uppercase tracking-wide text-muted">
      {MINI_STAT_LABELS.map((label) => (
        <div key={label}>{label}</div>
      ))}
    </div>
  );
}

/** One value cell. The label lives in the sibling MiniStatHeader, so the number
 *  gets the room the label used to take (text-xs -> text-small). */
export function MiniStat({ value, colorClass }: { value: string; colorClass?: string }) {
  return (
    <div className={`font-mono text-small [font-variant-numeric:tabular-nums] ${colorClass ?? "text-secondary"}`}>
      {value}
    </div>
  );
}

export function EntityIcon({
  iconUrl,
  rarity,
  sizeClass = "h-7 w-7",
}: {
  iconUrl: string;
  rarity?: EntityRarity;
  /** Tailwind height/width classes — kept static (not interpolated) so the JIT scanner picks them up. */
  sizeClass?: string;
}) {
  if (rarity === "prismatic") {
    return (
      <span className={`relative flex ${sizeClass} shrink-0 p-[2px]`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconUrl} alt="" className="h-full w-full rounded-[4px] object-cover" />
        {/* The gradient has to be a *ring*, not a fill behind the icon.
            Augment icons are white glyphs on a fully transparent background —
            unlike item icons, which are opaque art — so a background-image on
            the wrapper showed straight through the whole tile and turned every
            prismatic augment into a pale lavender square, while silver/gold
            (which use a real `border`) kept their dark ground.

            Masking the centre out of a gradient-filled overlay is what keeps
            this working on any surface: the icon sits on a table row that
            changes colour on hover, so painting an opaque inner square to fake
            the ring would show as a visible patch there. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-md p-[2px]"
          style={{
            backgroundImage: "var(--prism-frame)",
            WebkitMaskImage: "linear-gradient(#000 0 0), linear-gradient(#000 0 0)",
            WebkitMaskClip: "content-box, border-box",
            WebkitMaskComposite: "xor",
            maskImage: "linear-gradient(#000 0 0), linear-gradient(#000 0 0)",
            maskClip: "content-box, border-box",
            maskComposite: "exclude",
          }}
        />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl}
      alt=""
      className={`${sizeClass} shrink-0 rounded-md object-cover ${
        rarity ? RARITY_BORDER[rarity] : "border border-subtle"
      }`}
    />
  );
}
