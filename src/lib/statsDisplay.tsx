// Plain (non-"use client") helpers shared between the client-side StatsTable
// and server-rendered pages like the champion detail page — functions and
// components exported from a "use client" file can't be called from a server
// component, only rendered as JSX, so these live outside StatsTable.tsx.

export type EntityRarity = "silver" | "gold" | "prismatic";

/** « 126,814 » plutôt que « 126814 » : le site est en anglais, séparateur à la
 *  virgule. Fixé à en-US pour que serveur et navigateur écrivent pareil. */
export function formatCount(n: number) {
  return n.toLocaleString("en-US");
}

/**
 * Ce que « bon » et « mauvais » veulent dire DANS une liste donnée.
 *
 * Des seuils fixes ne tenaient pas : sur le 16.18 (lignes à 100 parties ou
 * plus), 113 items sur 169 avaient un % Top 3 vert, contre 14 champions sur 173
 * et aucun avg de champion. Les items achetés et les augments choisis partent
 * d'un niveau plus haut que les champions, donc un seuil commun colorait
 * presque tout d'un côté et presque rien de l'autre. Décidé avec Théo le
 * 2026-09-28 : le vert marque les ~15 % meilleurs de la liste affichée, le rouge
 * les ~15 % pires, le reste est neutre. Une couleur rare est une couleur qu'on
 * lit.
 */
export type StatScale = {
  avg: { good: number; bad: number };
  top3: { good: number; bad: number };
  top1: { good: number; bad: number };
  /** Sous ce nombre de parties, une ligne ne reçoit pas de verdict : ses
   *  chiffres bougent trop pour qu'un vert ou un rouge veuille dire quelque
   *  chose, et elles occuperaient les extrêmes à la place des vraies. */
  minGames: number;
};

const QUALITY_SHARE = 0.15;
/** En dessous, pas assez de lignes pour parler de « 15 % » : seuils fixes. */
const MIN_SCALE_ROWS = 10;

type ScaleRow = { games: number; avgPlacement: number; top3Rate: number; top1Rate: number };

function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function statScale(rows: ScaleRow[]): StatScale | undefined {
  if (rows.length < MIN_SCALE_ROWS) return undefined;
  const games = rows.map((r) => r.games).sort((a, b) => a - b);
  // Un dixième de la médiane, et jamais moins de 20 parties.
  const minGames = Math.max(20, Math.round(quantile(games, 0.5) / 10));
  const eligible = rows.filter((r) => r.games >= minGames);
  if (eligible.length < MIN_SCALE_ROWS) return undefined;
  const sorted = (pick: (r: ScaleRow) => number) => eligible.map(pick).sort((a, b) => a - b);
  const avg = sorted((r) => r.avgPlacement);
  const top3 = sorted((r) => r.top3Rate);
  const top1 = sorted((r) => r.top1Rate);
  return {
    // Plus bas = meilleur pour l'avg : le « bon » bord est le quantile bas.
    avg: { good: quantile(avg, QUALITY_SHARE), bad: quantile(avg, 1 - QUALITY_SHARE) },
    top3: { good: quantile(top3, 1 - QUALITY_SHARE), bad: quantile(top3, QUALITY_SHARE) },
    top1: { good: quantile(top1, 1 - QUALITY_SHARE), bad: quantile(top1, QUALITY_SHARE) },
    minGames,
  };
}

const NEUTRAL = "text-primary";

function scaledColor(
  value: number,
  band: { good: number; bad: number },
  lowerIsBetter: boolean,
  games: number | undefined,
  minGames: number,
) {
  if (games !== undefined && games < minGames) return NEUTRAL;
  if (lowerIsBetter ? value <= band.good : value >= band.good) return "text-stat-good";
  if (lowerIsBetter ? value >= band.bad : value <= band.bad) return "text-stat-bad";
  return NEUTRAL;
}

// `null` = pas de couleur du tout (les Combos : une liste de meilleures paires,
// où du rouge sur un 2.5 dirait « mauvais » à tort).
// Sans échelle (une stat seule, ou une liste trop courte), on retombe sur des
// seuils fixes autour de l'espérance d'une partie à 6 équipes.
// % Top 3 averages ~50% (3 of 6 teams) — thresholds centered on that.
// Reserved colors: this is the only place green/red should ever appear.
export function top3Color(rate: number, scale?: StatScale | null, games?: number) {
  if (scale === null) return NEUTRAL;
  if (scale) return scaledColor(rate, scale.top3, false, games, scale.minGames);
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
export function top1Color(rate: number, scale?: StatScale | null, games?: number) {
  if (scale === null) return NEUTRAL;
  if (scale) return scaledColor(rate, scale.top1, false, games, scale.minGames);
  if (rate >= 0.2) return "text-stat-good";
  if (rate >= 0.13) return "text-secondary";
  return "text-stat-bad";
}

// Avg placement over 6 teams — the expected value is 3.5, so the band sits
// around that: -0.3 to clear into green, +0.2 to drop into red. Comparisons are
// inverted relative to top3Color/top1Color because here *lower* is better.
// Same reserved-color rule: green/red only ever mean "this number is good/bad".
export function avgPlacementColor(avg: number, scale?: StatScale | null, games?: number) {
  if (scale === null) return NEUTRAL;
  if (scale) return scaledColor(avg, scale.avg, true, games, scale.minGames);
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
      // Translucent + blurred rather than opaque: on the champion page this row
      // overlaps the splash banner, and letting the art show through is the
      // point. On a plain background it reads as a normal raised card.
      className={`rounded-xl border px-4 py-2.5 text-center backdrop-blur-md ${
        emphasis
          ? "border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] shadow-[var(--elev-2)]"
          : "border-subtle bg-[color:var(--bg-raised)]/80 shadow-[var(--elev-1)]"
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
    <div className={`tabular-nums text-small [font-variant-numeric:tabular-nums] ${colorClass ?? "text-secondary"}`}>
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

const PLACE_LABELS = ["1st", "2nd", "3rd", "4th", "5th", "6th"] as const;

/**
 * Colour of each place's bar. 1st takes gold, which globals.css reserves for
 * "the best" (tier S and 1st place). 2nd and 3rd are the rest of a top 3, in
 * the accent; 4th to 6th stay quiet. The shape then reads at a glance: a
 * champion that wins is heavy on the left.
 */
const PLACE_COLORS = [
  "var(--gold)",
  "color-mix(in srgb, var(--accent) 75%, transparent)",
  "color-mix(in srgb, var(--accent) 55%, transparent)",
  "var(--border-strong)",
  "var(--border-strong)",
  "var(--border-strong)",
] as const;

/** Six places, so an even spread puts 1 game in 6 at each. */
const EVEN_SHARE = 1 / 6;

function placeShares(counts: number[]) {
  const total = counts.reduce((a, b) => a + b, 0);
  return total > 0 ? counts.map((c) => c / total) : [];
}

/**
 * The bars share one fixed scale, 0 to 30 %, in every row of every list:
 * normalising per row would make every champion's tallest bar the same height
 * and hide exactly what the chart is for, which is comparing shapes down a
 * column. Measured on 16.18, a single place never passes 25 % for a champion
 * with a real sample; above 30 % the scale grows rather than clip.
 */
function barScale(shares: number[]) {
  return Math.max(0.3, ...shares);
}

function placementSummary(shares: number[]) {
  return shares.map((s, i) => `${PLACE_LABELS[i]} ${(s * 100).toFixed(1)}%`).join(" · ");
}

/** Six thin bars, 1st to 6th, for a table cell. */
export function PlacementSparkline({ counts }: { counts: number[] }) {
  const shares = placeShares(counts);
  if (shares.length !== 6) return null;
  const max = barScale(shares);
  const label = placementSummary(shares);
  return (
    <span role="img" aria-label={`Finishes: ${label}`} title={label} className="inline-flex h-6 items-end gap-[3px]">
      {shares.map((share, i) => (
        <span
          key={i}
          className="block w-[5px] rounded-t-[1px]"
          style={{ height: `${(share / max) * 100}%`, backgroundColor: PLACE_COLORS[i] }}
        />
      ))}
    </span>
  );
}

/** The same six places, large, with their share written on each bar. */
export function PlacementChart({ counts }: { counts: number[] }) {
  const shares = placeShares(counts);
  if (shares.length !== 6) return null;
  const max = barScale(shares);
  return (
    <figure className="m-0">
      <div
        role="img"
        aria-label={`Finishes: ${placementSummary(shares)}`}
        className="relative grid h-36 grid-cols-6 items-end gap-2 border-b border-default sm:gap-3"
      >
        {/* The even-spread line: above it a place comes up more often than
            chance, below it less. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-strong"
          style={{ bottom: `${(EVEN_SHARE / max) * 100}%` }}
        />
        {shares.map((share, i) => (
          <div key={i} className="relative flex h-full flex-col justify-end">
            <span className="mb-1 text-center text-small font-medium tabular-nums text-primary">
              {(share * 100).toFixed(1)}%
            </span>
            <span
              className="block rounded-t-sm"
              style={{ height: `${(share / max) * 100}%`, backgroundColor: PLACE_COLORS[i] }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1.5 grid grid-cols-6 gap-2 text-center text-micro text-muted sm:gap-3">
        {PLACE_LABELS.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <figcaption className="mt-2 text-micro text-muted">Dashed line: 1 game in 6, an even spread.</figcaption>
    </figure>
  );
}

/**
 * A real change of Avg Placement since the previous patch (beyond three
 * standard errors, see getChampionMovers). Lower is better, so a drop in the
 * number is the good direction, shown as ▲ in the "good" colour.
 */
export function MoverBadge({
  avgPlacement,
  previousAvgPlacement,
  previousPatch,
}: {
  avgPlacement: number;
  previousAvgPlacement: number;
  previousPatch: string | null;
}) {
  const delta = avgPlacement - previousAvgPlacement;
  const better = delta < 0;
  const since = previousPatch ? ` since ${previousPatch}` : "";
  return (
    <span
      title={`Avg placement ${previousAvgPlacement.toFixed(2)} → ${avgPlacement.toFixed(2)}${since}`}
      className={`inline-flex items-center gap-0.5 text-micro font-medium tabular-nums ${better ? "text-stat-good" : "text-stat-bad"}`}
    >
      <span aria-hidden="true">{better ? "▲" : "▼"}</span>
      <span className="sr-only">{better ? "Better" : "Worse"}{since}:</span>
      {Math.abs(delta).toFixed(2)}
    </span>
  );
}
