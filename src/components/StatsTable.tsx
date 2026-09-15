"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { computeTiers, TIER_STYLES, type Tier, type TierInfo } from "@/lib/tiers";
import { RankBadge } from "@/components/RankBadge";
import type { Tier as RankTier } from "@/lib/rating";
import {
  top1Color,
  top3Color,
  avgPlacementColor,
  EntityIcon,
  type EntityRarity,
} from "@/lib/statsDisplay";
import { SlidingHighlight, useSlidingHighlight } from "@/components/SlidingHighlight";
import { EntityTooltip, type EntityRef } from "@/components/EntityTooltip";

export type StatsRow = {
  key: string;
  name: string;
  iconUrl?: string;
  games: number;
  top3Rate: number;
  top1Rate: number;
  avgPlacement: number;
  playRate: number;
  /** Augment rarity (silver/gold/prismatic) — colors the icon frame like in-game. */
  rarity?: EntityRarity;
  /** Le rang Arena du joueur (leaderboard uniquement). Son absence est une
   *  information : le joueur n'a pas encore assez de parties suivies. */
  rankTier?: RankTier;
  /** Le rang RÉEL de la ligne, quand il ne se déduit pas de sa position.
   *
   *  Sur le classement, le numéro affiché doit rester le rang à l'échelle du
   *  ladder : filtrer sur trois joueurs affichait « 1, 2, 3 » alors qu'ils sont
   *  57e, 203e et 891e. Les tier lists n'en ont pas — leur numéro EST la
   *  position dans le tri courant, et c'est ce qu'on veut y lire. */
  rank?: number;
  /** Item ou augment que représente la ligne : fait apparaître sa description
   *  au survol de l'icône. Absent pour les champions et les joueurs, qui n'en
   *  ont pas — l'infobulle se réduit alors au nom. */
  entity?: EntityRef;
  secondaryEntity?: EntityRef;
  /** When set, the name cell renders as a "name + secondaryName" pair — used
   * for the Combos tier list (two items/augments picked together). */
  secondaryName?: string;
  secondaryIconUrl?: string;
  secondaryRarity?: EntityRarity;
  /** When set, the name cell renders these as chips instead of icon + name —
   * used by Team Comps, whose "entity" is three champion classes with no art
   * of their own. Takes precedence over name/iconUrl. */
  roles?: string[];
  /** Métriques corrigées servant au calcul du tier, quand elles diffèrent de
   *  celles affichées — voir lib/tiers.ts. Les items s'en servent. */
  tierStat?: { avgPlacement: number; top3Rate: number; top1Rate: number };
  /** Present only on augments with enough picks in each of the first three
   * slots. Unlocks the "Better early"/"Better late" sorts on the grid. */
  timing?: {
    /** Baseline-adjusted (3rd pick − 1st pick) % Top 3. Positive = hold it. */
    swing: number;
    /** % Top 3 as a 1st / 2nd / 3rd pick — shown on hover, not on the card. */
    rates: number[];
  };
};

/**
 * Deliberately monochrome. Six class colors would be six new hues competing
 * with the ones globals.css reserves for meaning (cyan = interactive, gold =
 * best, green/red = stat quality), and "Fighter" being orange wouldn't tell
 * anyone anything that the word doesn't.
 */
export function RoleChips({ roles }: { roles: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {roles.map((role, i) => (
        <span
          key={`${role}-${i}`}
          className="rounded-md border border-subtle bg-inset px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-secondary"
        >
          {role}
        </span>
      ))}
    </span>
  );
}

export type SortKey =
  | "tier"
  /** Leaderboard : l'ordre du classement MMR, tel que la page l'a fourni. */
  | "rank"
  | "top3Rate"
  | "top1Rate"
  | "avgPlacement"
  | "playRate"
  | "games"
  /** Grid-only, and only where rows carry `timing` — see StatsGrid. */
  | "later"
  | "earlier";

/**
 * How many rows a card layout renders before the "Show more" button.
 *
 * The desktop table can afford to emit every row because it lives in a
 * `max-h-[75vh]` scrollport — the page height stays constant no matter how
 * many rows there are. A card list in normal page flow has no such ceiling:
 * the leaderboard's ~7.8k tracked players came to a 1,019,060px-tall page.
 */
export const CARD_PAGE_SIZE = 40;

export function ShowMoreButton({
  shown,
  total,
  onClick,
}: {
  shown: number;
  total: number;
  onClick: () => void;
}) {
  if (shown >= total) return null;
  return (
    <button
      onClick={onClick}
      className="mt-3 w-full rounded-lg border border-subtle bg-raised/40 py-2.5 text-small font-medium text-secondary transition-[color,background-color,border-color,transform] duration-150 hover:border-default hover:bg-overlay hover:text-primary active:scale-[0.99]"
    >
      Show more · {shown} of {total}
    </button>
  );
}

export function SampleSizeBadge({ totalMatches }: { totalMatches: number }) {
  return (
    <p className="text-small text-muted">
      Sample size: <span className="text-secondary">{totalMatches}</span> match
      {totalMatches === 1 ? "" : "es"} tracked so far — data grows with every search
    </p>
  );
}

// Real-world medal metaphor, not part of the reserved signal-color set —
// except 1st place, which deliberately reuses --gold (see globals.css:
// "reserved for tier S and 1st place").
const MEDALS: Record<number, { bg: string; text: string; ring: string }> = {
  1: { bg: "bg-gold", text: "text-[#241a06]", ring: "ring-[color:var(--gold-border)]" },
  2: {
    bg: "bg-[color:var(--rarity-silver)]",
    text: "text-[#1c1e24]",
    ring: "ring-[color:var(--rarity-silver)]/40",
  },
  3: { bg: "bg-[#B5793B]", text: "text-[#2a1a08]", ring: "ring-[#B5793B]/35" },
};

function RankCell({ rank }: { rank: number }) {
  const medal = MEDALS[rank];
  if (medal) {
    return (
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ring-2 ${medal.bg} ${medal.text} ${medal.ring}`}
      >
        {rank}
      </span>
    );
  }
  return <span className="font-mono tabular-nums text-muted">{rank}</span>;
}

export function TierBadge({ tier }: { tier: Tier }) {
  const style = TIER_STYLES[tier];
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border font-display text-sm font-bold ${style.bg} ${style.text} ${style.border} ${style.glow}`}
    >
      {tier}
    </span>
  );
}

/** The "S TIER ─────" rule. Shared by the table, the mobile card list and StatsGrid. */
export function TierBandHeading({ tier }: { tier: Tier }) {
  const style = TIER_STYLES[tier];
  return (
    <div
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 font-display text-h2 font-semibold"
      style={{
        color: style.hex,
        backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${style.hex} 14%, transparent), transparent 55%)`,
      }}
    >
      {tier} Tier
      <span className="h-px flex-1" style={{ backgroundColor: style.hex, opacity: 0.25 }} />
    </div>
  );
}

function TierBandRow({ tier, colSpan, isFirst }: { tier: Tier; colSpan: number; isFirst: boolean }) {
  return (
    <tr aria-hidden="true">
      <td colSpan={colSpan} className={`px-4 pb-1.5 ${isFirst ? "pt-3" : "pt-5"}`}>
        <TierBandHeading tier={tier} />
      </td>
    </tr>
  );
}

/**
 * Sens du tri : « best » met les meilleures lignes en tête, « worst » les pires.
 *
 * On raisonne en qualité, pas en valeur croissante/décroissante, parce que les
 * deux ne coïncident pas : la meilleure ligne a le PLUS de % Top 3 mais le
 * MOINS de placement moyen. Un seul concept pour l'utilisateur (meilleur
 * d'abord, puis pire d'abord), la conversion se fait ici.
 */
export type SortDir = "best" | "worst";

/** Les colonnes où « meilleur » veut dire « plus petit ». */
function bestIsAscending(key: SortKey): boolean {
  return key === "avgPlacement" || key === "rank";
}

/** La flèche à afficher : le sens RÉEL des valeurs, convention habituelle des
 *  tableaux, et non le sens de la qualité — qui varie d'une colonne à l'autre
 *  et n'est pas lisible sur une flèche. */
export function sortAscending(key: SortKey, dir: SortDir): boolean {
  return dir === "best" ? bestIsAscending(key) : !bestIsAscending(key);
}

/**
 * Normalise une chaîne pour la recherche : minuscules et sans accents.
 *
 * Sans ça « mundo » ne trouve pas « Dr. Mundo » à cause de la casse, et
 * « rene » ne trouve pas « Renata » — les noms de champions et d'objets sont
 * pleins de diacritiques que personne ne tape.
 */
export function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Tout ce sur quoi une ligne peut être trouvée : son nom, celui de sa moitié
 *  de paire (Combos) et ses rôles (Team Comps, qui n'ont pas de nom du tout). */
export function rowHaystack(row: StatsRow): string {
  return normalizeForSearch(
    [row.name, row.secondaryName, ...(row.roles ?? [])].filter(Boolean).join(" "),
  );
}

/** Generic over the key type so pages with their own sort axes (augment timing)
 *  reuse it without casting through SortKey. */
export function SortControl<K extends string>({
  sortBy,
  onChange,
  options,
  dir,
}: {
  sortBy: K;
  onChange: (s: K) => void;
  options: { key: K; label: string }[];
  /** Sens courant, pour que la pastille active dise aussi vers où ça trie.
   *  Absent là où le tri n'a qu'un sens (grilles, timing d'augments). */
  dir?: SortDir;
}) {
  const { containerRef, register, rect } = useSlidingHighlight(sortBy, options);

  return (
    // Label above the pills on narrow screens: side-by-side, the pill group
    // takes the width it needs and squeezes "Sort by:" into two lines.
    <div className="mb-3 flex flex-col items-start gap-1.5 text-small sm:flex-row sm:items-center sm:gap-2">
      <span className="shrink-0 text-muted">Sort by:</span>
      <div
        ref={containerRef}
        className="relative inline-flex flex-wrap rounded-lg border border-subtle bg-inset p-1"
      >
        <SlidingHighlight rect={rect} />
        {options.map((opt) => (
          <button
            key={opt.key}
            ref={register(opt.key)}
            onClick={() => onChange(opt.key)}
            className={`relative z-10 rounded-md px-3 py-1.5 font-medium transition-[color,transform] duration-75 active:scale-[0.97] ${
              sortBy === opt.key ? "text-primary" : "text-muted hover:text-secondary"
            }`}
          >
            {opt.label}
            {dir && sortBy === opt.key && (
              <span aria-hidden className="ml-1 text-muted">
                {sortAscending(opt.key as unknown as SortKey, dir) ? "\u2191" : "\u2193"}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Ce que renvoie la route de recherche étendue (voir searchBeyondUrl). */
type LeaderboardSearchRow = {
  puuid: string;
  riotId: string;
  tier: string;
  position: number;
  games: number;
  top3Rate: number;
  top1Rate: number;
  avgPlacement: number;
  playRate: number;
};

function searchRowToStatsRow(p: LeaderboardSearchRow): StatsRow {
  return {
    key: p.puuid,
    name: p.riotId,
    rankTier: p.tier as RankTier,
    rank: p.position,
    games: p.games,
    top3Rate: p.top3Rate,
    top1Rate: p.top1Rate,
    avgPlacement: p.avgPlacement,
    playRate: p.playRate,
  };
}

/**
 * Un en-tête de colonne qui trie.
 *
 * Remplace la rangée de pastilles au-dessus du tableau : elle répétait mot pour
 * mot les intitulés de la première ligne, à trois centimètres d'écart. Le
 * tableau portait déjà les noms des métriques — il lui manquait juste de
 * répondre au clic.
 *
 * Trois états par colonne, comme demandé : meilleur d'abord, pire d'abord, puis
 * retour au tri de repos. La flèche suit le sens RÉEL des valeurs (convention
 * des tableaux), pas celui de la qualité, qui s'inverse d'une colonne à l'autre
 * et ne se lit pas sur une flèche.
 */
function SortableHead({
  label,
  sortKey,
  sortBy,
  sortDir,
  onSort,
  className,
  align = "left",
}: {
  label: React.ReactNode;
  /** Absent = colonne non triable (le rang, le nom). */
  sortKey?: SortKey;
  sortBy: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className: string;
  align?: "left" | "right";
}) {
  if (!sortKey) return <th className={className}>{label}</th>;

  const active = sortBy === sortKey;
  const ascending = active && sortAscending(sortKey, sortDir);

  return (
    <th className={className} aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group/sort inline-flex w-full cursor-pointer items-center gap-1 uppercase tracking-wide transition-colors hover:text-secondary ${
          align === "right" ? "justify-end" : ""
        } ${active ? "text-secondary" : ""}`}
      >
        {label}
        {/* Toujours rendu, même inactif : sinon la largeur de la colonne saute
            au premier clic et toute la ligne d'en-tête se décale. Et toujours
            VISIBLE, même faiblement : réserver la flèche au survol, c'est
            cacher la seule chose qui dit que l'en-tête répond au clic — à la
            souris on finit par le découvrir, au doigt jamais. */}
        <span
          aria-hidden
          className={`text-[10px] leading-none transition-opacity ${
            active ? "opacity-100" : "opacity-30 group-hover/sort:opacity-70"
          }`}
        >
          {active ? (ascending ? "\u2191" : "\u2193") : "\u2195"}
        </span>
      </button>
    </th>
  );
}

/**
 * Filtre texte d'une tier list.
 *
 * Les listes font 170 champions ou 200 combos : sans ça, trouver une ligne
 * précise se fait au défilement et à l'œil. Le compteur ne s'affiche que
 * pendant la frappe — hors filtre il répéterait le total déjà connu.
 */
export function FilterInput({
  value,
  onChange,
  placeholder,
  shown,
  total,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  shown: number;
  total: number;
}) {
  return (
    <div className="w-full sm:w-60">
      <div className="relative">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
          aria-hidden
        >
          <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M17.5 17.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full rounded-lg border border-subtle bg-inset py-1.5 pl-8 pr-8 text-small text-primary placeholder:text-muted focus:border-accent"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear filter"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-small text-muted transition-colors hover:text-primary"
          >
            {"\u00d7"}
          </button>
        )}
      </div>
      {value.trim() !== "" && (
        <p className="mt-1 text-micro tabular-nums text-muted">
          {shown} of {total}
        </p>
      )}
    </div>
  );
}

/** L'icône d'une entité, rendue avec son infobulle quand on sait ce qu'elle
 *  représente. Sans `entity`, l'icône reste telle quelle : pas d'infobulle
 *  vide sur les lignes de champion ou de joueur. */
function TooltipIcon({
  entity,
  name,
  iconUrl,
  rarity,
}: {
  entity?: EntityRef;
  name: string;
  iconUrl: string;
  rarity?: EntityRarity;
}) {
  const icon = <EntityIcon iconUrl={iconUrl} rarity={rarity} sizeClass="h-8 w-8" />;
  if (!entity) return icon;
  return (
    <EntityTooltip entity={entity} name={name}>
      {icon}
    </EntityTooltip>
  );
}

function NameCellContent({ row }: { row: StatsRow }) {
  if (row.roles) return <RoleChips roles={row.roles} />;
  if (row.secondaryName) {
    return (
      <>
        {row.iconUrl && (
          <TooltipIcon entity={row.entity} name={row.name} iconUrl={row.iconUrl} rarity={row.rarity} />
        )}
        <span className="font-medium text-primary">{row.name}</span>
        <span className="text-muted">+</span>
        {row.secondaryIconUrl && (
          <TooltipIcon
            entity={row.secondaryEntity}
            name={row.secondaryName}
            iconUrl={row.secondaryIconUrl}
            rarity={row.secondaryRarity}
          />
        )}
        <span className="font-medium text-primary">{row.secondaryName}</span>
      </>
    );
  }
  return (
    <>
      {row.iconUrl && (
        <TooltipIcon entity={row.entity} name={row.name} iconUrl={row.iconUrl} rarity={row.rarity} />
      )}
      <span className="font-medium text-primary">{row.name}</span>
    </>
  );
}

export function EmptyState({
  message = "Nothing tracked here yet.",
}: {
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-default bg-raised/30 px-6 py-12 text-center">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-8 w-8 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" d="M4 19V9m5 10V5m5 14v-7m5 7V8" />
      </svg>
      <p className="mt-3 text-secondary">{message}</p>
      <p className="mt-1 max-w-xs text-small text-muted">
        Every search on this site adds its matches to the pool.
      </p>
      <Link
        href="/"
        className="mt-4 rounded-lg border border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] px-3.5 py-1.5 text-small font-medium text-accent transition-[background-color,transform] duration-150 hover:bg-[color:var(--accent)]/20 active:scale-[0.97]"
      >
        Search a player
      </Link>
    </div>
  );
}

// Normalized-to-column-max bar width behind %Top3/%Top1, in percent of cell
// width — capped so it never touches the far edge, floored so a near-zero
// value still shows a visible sliver.
//
// The bar is anchored right (`right-0`), not left: the number it sits behind is
// right-aligned, so a left-anchored bar stopped short of the digits on any low
// value and read as a stray empty rectangle next to an orphan number.
export function meterWidth(value: number, max: number) {
  if (max <= 0) return 0;
  return Math.max(3, Math.min(92, (value / max) * 92));
}

// Sibling of meterWidth for metrics where *lower* is better (avg placement).
// Normalized against this batch's own best/worst rather than the theoretical
// 1..6, so the bars actually spread out instead of all sitting near the middle.
export function placementMeterWidth(avg: number, best: number, worst: number) {
  if (worst - best < 1e-9) return 50;
  return Math.max(3, Math.min(92, ((worst - avg) / (worst - best)) * 92));
}

const stickyHeadCell = "sticky top-0 z-30 border-b border-default bg-inset py-3 font-medium";

function DataRow({
  row,
  rank,
  variant,
  tierMap,
  linkPrefix,
  linkSuffix,
  maxTop3,
  maxTop1,
  bestPlacement,
  worstPlacement,
  hideTierColumn,
  showRankColumn,
  compact,
}: {
  row: StatsRow;
  rank: number;
  variant: "tiers" | "ranked";
  tierMap: Map<string, TierInfo>;
  linkPrefix?: string;
  linkSuffix?: string;
  maxTop3: number;
  maxTop1: number;
  bestPlacement: number;
  worstPlacement: number;
  /** Suppressed while tier bands are shown — the band right above already says
   *  the tier, so the badge is the same letter repeated down the whole band. */
  hideTierColumn: boolean;
  /** Colonne du rang Arena : présente dès qu'au moins un joueur est classé. */
  showRankColumn: boolean;
  /** See StatsTable's `compact` — must drop the same columns as the header. */
  compact: boolean;
}) {
  const cellX = compact ? "px-2" : "px-4";
  const tierInfo = variant === "tiers" ? tierMap.get(row.key) : undefined;
  const railHex = tierInfo ? TIER_STYLES[tierInfo.tier].hex : "transparent";

  return (
    <tr
      id={`entity-${row.key}`}
      className="group border-b border-subtle transition-colors duration-150 last:border-0 hover:bg-overlay"
      style={{ "--rail": railHex } as React.CSSProperties}
    >
      <td className="border-l-2 border-l-[color:var(--rail)] py-1.5 pl-[14px] pr-4 transition-[border-width,padding] duration-150 group-hover:border-l-4 group-hover:pl-3">
        {variant === "ranked" ? (
          <RankCell rank={row.rank ?? rank + 1} />
        ) : (
          <span className="font-mono tabular-nums text-muted">{rank + 1}</span>
        )}
      </td>
      {variant === "tiers" && !hideTierColumn && (
        <td className={`${cellX} py-1.5`}>
          <TierBadge tier={tierMap.get(row.key)!.tier} />
        </td>
      )}
      {showRankColumn && (
        <td className={`${cellX} py-1.5`}>
          {row.rankTier ? <RankBadge tier={row.rankTier} /> : null}
        </td>
      )}
      <td className={`${cellX} py-1.5`}>
        {linkPrefix ? (
          <Link href={`${linkPrefix}${row.key}${linkSuffix ?? ""}`} className="flex items-center gap-2.5 hover:underline">
            <NameCellContent row={row} />
          </Link>
        ) : (
          <div className="flex items-center gap-2.5">
            <NameCellContent row={row} />
          </div>
        )}
      </td>
      {/* Avg Placement leads: it is the metric that outranks the others
          everywhere on this site (docs/design-audit-plan.md §3.6), and it is
          what computeTiers weights at 60%. */}
      <td className={`relative ${cellX} py-1.5 text-right font-mono tabular-nums`}>
        <span
          aria-hidden="true"
          className="absolute inset-y-[5px] right-0 rounded-[3px] bg-[color:var(--accent-muted)]"
          style={{ width: `${placementMeterWidth(row.avgPlacement, bestPlacement, worstPlacement)}%` }}
        />
        <span className={`relative ${avgPlacementColor(row.avgPlacement)}`}>
          {row.avgPlacement.toFixed(2)}
        </span>
      </td>
      <td className={`relative ${cellX} py-1.5 text-right font-mono tabular-nums`}>
        <span
          aria-hidden="true"
          className="absolute inset-y-[5px] right-0 rounded-[3px] bg-[color:var(--accent-muted)]"
          style={{ width: `${meterWidth(row.top3Rate, maxTop3)}%` }}
        />
        <span className={`relative ${top3Color(row.top3Rate)}`}>{(row.top3Rate * 100).toFixed(1)}%</span>
      </td>
      {variant === "tiers" && !compact && (
        <td className={`relative ${cellX} py-1.5 text-right font-mono tabular-nums`}>
          <span
            aria-hidden="true"
            className="absolute inset-y-[5px] right-0 rounded-[3px] bg-[color:var(--accent-muted)]"
            style={{ width: `${meterWidth(row.top1Rate, maxTop1)}%` }}
          />
          <span className={`relative ${top1Color(row.top1Rate)}`}>{(row.top1Rate * 100).toFixed(1)}%</span>
        </td>
      )}
      <td className={`${cellX} py-1.5 text-right font-mono tabular-nums text-secondary`}>{row.games}</td>
      {variant === "tiers" && !compact && (
        <td className={`${cellX} py-1.5 text-right font-mono tabular-nums text-secondary`}>
          {(row.playRate * 100).toFixed(1)}%
        </td>
      )}
    </tr>
  );
}

/**
 * Below `md` the table is replaced by these, not scrolled sideways.
 *
 * The table needs ~640px to fit its 8 columns, so on a phone everything past
 * "Games" used to sit off-screen inside an `overflow-auto` with no scroll
 * affordance — i.e. a stats site showing no stats. Same numbers, stacked:
 * headline % Top 3 with its meter, then the rest on one line.
 */
function MobileCard({
  row,
  rank,
  variant,
  tierInfo,
  linkPrefix,
  linkSuffix,
  bestPlacement,
  worstPlacement,
  playRateLabel,
  hideTierBadge,
}: {
  row: StatsRow;
  rank: number;
  variant: "tiers" | "ranked";
  tierInfo?: TierInfo;
  /** Same rule as the desktop table's Tier column: suppressed while bands are
   *  shown, since the band right above already says the letter. */
  hideTierBadge: boolean;
  linkPrefix?: string;
  linkSuffix?: string;
  bestPlacement: number;
  worstPlacement: number;
  playRateLabel: string;
}) {
  const railHex = tierInfo ? TIER_STYLES[tierInfo.tier].hex : "var(--border-default)";

  // Each icon+name is one flex item, so a combo pair wraps *between* its two
  // halves rather than orphaning "Dragonheart" onto its own line under the
  // icon it doesn't belong to.
  const heading = row.roles ? (
    <div className="min-w-0 flex-1">
      <RoleChips roles={row.roles} />
    </div>
  ) : (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="flex min-w-0 items-center gap-2">
        {row.iconUrl && (
          <TooltipIcon entity={row.entity} name={row.name} iconUrl={row.iconUrl} rarity={row.rarity} />
        )}
        <span className="min-w-0 break-words font-medium text-primary">{row.name}</span>
      </span>
      {row.secondaryName && (
        <>
          <span className="text-muted">+</span>
          <span className="flex min-w-0 items-center gap-2">
            {row.secondaryIconUrl && (
              <TooltipIcon
                entity={row.secondaryEntity}
                name={row.secondaryName}
                iconUrl={row.secondaryIconUrl}
                rarity={row.secondaryRarity}
              />
            )}
            <span className="min-w-0 break-words font-medium text-primary">
              {row.secondaryName}
            </span>
          </span>
        </>
      )}
    </div>
  );

  return (
    <div
      id={`entity-${row.key}`}
      className="rounded-lg border border-subtle border-l-2 bg-raised/40 p-3"
      style={{ borderLeftColor: railHex }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 shrink-0 font-mono text-small tabular-nums text-muted">
          {variant === "ranked" ? <RankCell rank={row.rank ?? rank + 1} /> : rank + 1}
        </span>
        {linkPrefix ? (
          <Link href={`${linkPrefix}${row.key}${linkSuffix ?? ""}`} className="flex min-w-0 flex-1">
            {heading}
          </Link>
        ) : (
          heading
        )}
        {tierInfo && !hideTierBadge && <TierBadge tier={tierInfo.tier} />}
        {row.rankTier && <RankBadge tier={row.rankTier} />}
      </div>

      {/* Avg Placement is the headline number everywhere on this site — see
          docs/design-audit-plan.md §3.6. % Top 3 drops into the row below. */}
      <div className="mt-3 flex items-baseline gap-2">
        <span className={`font-display text-h1 font-semibold ${avgPlacementColor(row.avgPlacement)}`}>
          {row.avgPlacement.toFixed(2)}
        </span>
        <span className="text-micro uppercase tracking-wide text-muted">Avg Placement</span>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-1 overflow-hidden rounded-full bg-inset">
        <div
          className="h-full rounded-full bg-[color:var(--accent)]/45"
          style={{ width: `${placementMeterWidth(row.avgPlacement, bestPlacement, worstPlacement)}%` }}
        />
      </div>

      <dl className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-micro tabular-nums text-muted">
        <div className="flex items-baseline gap-1">
          <dt>Top 3</dt>
          <dd className={top3Color(row.top3Rate)}>{(row.top3Rate * 100).toFixed(1)}%</dd>
        </div>
        {variant === "tiers" && (
          <div className="flex items-baseline gap-1">
            <dt>Top 1</dt>
            <dd className={top1Color(row.top1Rate)}>{(row.top1Rate * 100).toFixed(1)}%</dd>
          </div>
        )}
        <div className="flex items-baseline gap-1">
          <dt>Games</dt>
          <dd className="text-secondary">{row.games}</dd>
        </div>
        {variant === "tiers" && (
          <div className="flex items-baseline gap-1">
            <dt>{playRateLabel.replace(/^%\s*/, "")}</dt>
            <dd className="text-secondary">{(row.playRate * 100).toFixed(1)}%</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function StatsTable({
  rows,
  variant = "tiers",
  linkPrefix,
  linkSuffix,
  playRateLabel = "% Played",
  filterPlaceholder = "Search\u2026",
  searchBeyondUrl,
  compact = false,
}: {
  rows: StatsRow[];
  variant?: "tiers" | "ranked";
  /** When set, the name cell links to `${linkPrefix}${row.key}` — used for Champions -> champion detail page. */
  linkPrefix?: string;
  /** Ajouté tel quel après la clé. Sert à emmener le patch sélectionné sur la
   *  page de destination (« ?patch=16.18 ») : sans lui, cliquer un champion
   *  depuis une tier list basculée ramènerait au patch par défaut. */
  linkSuffix?: string;
  /** Column/sort label for `playRate` — its meaning (and denominator) varies by page. */
  playRateLabel?: string;
  /** Ce que le filtre cherche sur CETTE page — « Search a champion », « Search
   *  a player »… Le mot compte : « Filter » seul laisse deviner sur quoi. */
  filterPlaceholder?: string;
  /** Route qui cherche AU-DELÀ des lignes publiées, quand la page n'en
   *  transporte qu'une partie (le classement publie 1 000 des 11 294 classés).
   *  Une URL et non une fonction : une page serveur ne peut pas passer de
   *  callback à un composant client. */
  searchBeyondUrl?: string;
  /** For a narrow sidebar column (the player page's Top Champions sits in a
   *  380px track). Drops the 640px floor and the two least important columns
   *  rather than clipping the table mid-cell behind a scrollbar nobody sees. */
  compact?: boolean;
}) {
  // Le tri de repos : celui auquel le troisième clic sur une colonne ramène.
  const defaultSortKey: SortKey =
    variant === "tiers" ? "tier" : rows.some((r) => r.rankTier) ? "rank" : "top3Rate";
  const [sortBy, setSortBy] = useState<SortKey>(defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>("best");
  const [filter, setFilter] = useState("");
  // Résultats venus du serveur, hors des lignes publiées.
  const [beyond, setBeyond] = useState<StatsRow[]>([]);
  const [searchingBeyond, setSearchingBeyond] = useState(false);
  // Mobile-only: see CARD_PAGE_SIZE. Reset from the sort handler rather than an
  // effect — re-sorting reshuffles which rows are "the first 40", so keeping an
  // expanded count would silently change what the button means.
  const [cardLimit, setCardLimit] = useState(CARD_PAGE_SIZE);

  // Every row gets a fixed tier from the combined games/placement/top1/top3
  // score, independent of whatever sort is currently selected.
  const tierMap = useMemo(() => computeTiers(rows), [rows]);

  const { maxTop3, maxTop1, bestPlacement, worstPlacement } = useMemo(
    () => ({
      maxTop3: rows.reduce((m, r) => Math.max(m, r.top3Rate), 0),
      maxTop1: rows.reduce((m, r) => Math.max(m, r.top1Rate), 0),
      // "best" is the *lowest* average placement, hence the flipped reduces.
      bestPlacement: rows.reduce((m, r) => Math.min(m, r.avgPlacement), Infinity),
      worstPlacement: rows.reduce((m, r) => Math.max(m, r.avgPlacement), 0),
    }),
    [rows]
  );

  // La colonne n'apparaît que s'il y a un rang à montrer : sur un classement
  // tout neuf, une colonne vide poserait une question sans y répondre.
  const showRankColumn = variant === "ranked" && rows.some((r) => r.rankTier);

  const sorted = useMemo(() => {
    const copy = [...rows];
    // Un seul comparateur par colonne, toujours écrit « meilleur d'abord » ;
    // l'autre sens s'en déduit par inversion. Écrire les deux à la main, c'est
    // se tromper une fois sur deux sur le placement moyen.
    const order = new Map(rows.map((r, i) => [r.key, i]));
    const bestFirst: Record<string, (a: StatsRow, b: StatsRow) => number> = {
      top3Rate: (a, b) => b.top3Rate - a.top3Rate,
      top1Rate: (a, b) => b.top1Rate - a.top1Rate,
      avgPlacement: (a, b) => a.avgPlacement - b.avgPlacement,
      playRate: (a, b) => b.playRate - a.playRate,
      games: (a, b) => b.games - a.games,
      // Les lignes arrivent déjà dans l'ordre du classement : le MMR n'est pas
      // dans la ligne, et n'a pas à y être — on ne l'affiche jamais.
      rank: (a, b) => order.get(a.key)! - order.get(b.key)!,
      tier: (a, b) => tierMap.get(b.key)!.score - tierMap.get(a.key)!.score,
    };
    const compare = bestFirst[sortBy] ?? bestFirst.tier;
    copy.sort(sortDir === "best" ? compare : (a, b) => compare(b, a));
    return copy;
  }, [rows, sortBy, sortDir, tierMap]);

  // Le filtre s'applique APRÈS le tri : l'ordre ne dépend jamais de ce qui est
  // filtré, donc taper puis effacer rend exactement la liste de départ.
  const matched = useMemo(() => {
    const needle = normalizeForSearch(filter.trim());
    if (!needle) return sorted;
    return sorted.filter((row) => rowHaystack(row).includes(needle));
  }, [sorted, filter]);

  // Les lignes trouvées au-delà du publié viennent s'ajouter, dédoublonnées et
  // remises dans l'ordre du classement — pas collées à la fin, sinon un joueur
  // 57e apparaîtrait sous un 900e.
  const visible = useMemo(() => {
    // Les résultats étendus ne valent que pour la recherche EN COURS : filtrés
    // par la longueur plutôt qu'effacés à chaque frappe, ce qui éviterait mal
    // un setState synchrone dans l'effet.
    if (beyond.length === 0 || filter.trim().length < 2) return matched;
    const known = new Set(matched.map((r) => r.key));
    const extra = beyond.filter((r) => !known.has(r.key));
    if (extra.length === 0) return matched;
    return [...matched, ...extra].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  }, [matched, beyond, filter]);

  useEffect(() => {
    if (!searchBeyondUrl) return;
    const query = filter.trim();
    if (query.length < 2) return;
    let cancelled = false;
    // Attendre une pause de frappe : sans ça, « theoucs » part sept fois.
    // Tous les setState vivent dans ce callback, jamais dans le corps de
    // l'effet — sinon chaque frappe déclenche un rendu en cascade.
    const timer = setTimeout(() => {
      setSearchingBeyond(true);
      fetch(`${searchBeyondUrl}?q=${encodeURIComponent(query)}`)
        .then((res) => (res.ok ? res.json() : { players: [] }))
        .then((data: { players?: LeaderboardSearchRow[] }) => {
          if (cancelled) return;
          setBeyond((data.players ?? []).map(searchRowToStatsRow));
        })
        // Un échec de recherche ne doit pas vider le tableau déjà affiché.
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setSearchingBeyond(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filter, searchBeyondUrl]);

  const showBands = variant === "tiers" && sortBy === "tier";
  // Les lignes qui OUVRENT un bandeau de tier, calculées une fois.
  //
  // Le tableau et les cartes suivaient chacun leur propre variable mutée
  // pendant le rendu — deux fois la même logique, et une mutation que le
  // compilateur React signale à raison : rien ne garantit qu'un rendu parcoure
  // la liste une seule fois ni dans l'ordre. Un ensemble de clés se calcule
  // avant, et se lit sans état.
  const bandStarts = useMemo(() => {
    const starts = new Set<string>();
    if (!showBands) return starts;
    let previous: Tier | null = null;
    for (const row of visible) {
      const tier = tierMap.get(row.key)!.tier;
      if (tier !== previous) {
        starts.add(row.key);
        previous = tier;
      }
    }
    return starts;
  }, [visible, showBands, tierMap]);

  function cycleSort(key: SortKey) {
    setCardLimit(CARD_PAGE_SIZE);
    if (key !== sortBy) {
      setSortBy(key);
      setSortDir("best");
    } else if (sortDir === "best") {
      setSortDir("worst");
    } else {
      // Troisième clic : retour au tri de repos plutôt qu'un troisième ordre.
      setSortBy(defaultSortKey);
      setSortDir("best");
    }
  }

  if (rows.length === 0) return <EmptyState />;

  const sortOptions: { key: SortKey; label: string }[] =
    variant === "tiers"
      ? [
          { key: "tier", label: "Tier" },
          { key: "top3Rate", label: "% Top 3" },
          { key: "top1Rate", label: "% Top 1" },
          { key: "avgPlacement", label: "Avg Placement" },
          { key: "games", label: "Games" },
          { key: "playRate", label: playRateLabel },
        ]
      : [
          ...(showRankColumn ? [{ key: "rank" as SortKey, label: "Rank" }] : []),
          { key: "top3Rate", label: "% Top 3" },
          { key: "avgPlacement", label: "Avg Placement" },
          { key: "games", label: "Games" },
        ];

  // Pair rows (Combos) carry two icon+name blocks in one cell, so the table
  // needs ~785px rather than the ~640px the rest of the site's rows need. At
  // the md breakpoint that silently cut the last columns off inside the
  // scrollport, with no scroll affordance — the same failure the `compact`
  // prop fixes on the player page. Hand those rows the card layout for one
  // breakpoint longer instead. Classes are written out in full: Tailwind's
  // scanner can't see an interpolated breakpoint.
  const needsWideTable = rows.some((r) => r.secondaryName);
  const cardsClass = needsWideTable ? "lg:hidden" : "md:hidden";
  const tableClass = needsWideTable ? "hidden lg:block" : "hidden md:block";

  const colCount =
    (variant === "tiers" ? (showBands ? 7 : 8) - (compact ? 2 : 0) : 5) + (showRankColumn ? 1 : 0);
  const cellX = compact ? "px-2" : "px-4";


  const toolbar = (
    // Le tri en pastilles ne sert QUE la vue en cartes : au-dessus du point de
    // rupture, ce sont les en-têtes du tableau qui trient, et garder les deux
    // affichait la même liste de métriques deux fois à trois centimètres
    // d'intervalle. Les cartes, elles, n'ont pas d'en-tête à cliquer.
    // Le filtre d'abord, le tri ensuite. C'est ce qu'on cherche en premier —
    // une ligne précise — et ça le pose sous le titre, là où l'œil arrive. Le
    // tri part à droite : il ne sert qu'aux vues sans en-tête cliquable, donc
    // le laisser à gauche vidait ce côté sur toutes les autres pages.
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      {/* Pas de filtre dans la colonne étroite de la page joueur : la liste y
          fait quelques lignes, et le champ prendrait plus de place qu'elle. */}
      {!compact && (
        <FilterInput
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setCardLimit(CARD_PAGE_SIZE);
          }}
          placeholder={filterPlaceholder}
          shown={visible.length}
          total={rows.length}
        />
      )}
      <div className={`min-w-0 sm:ml-auto ${cardsClass}`}>
        <SortControl sortBy={sortBy} dir={sortDir} onChange={cycleSort} options={sortOptions} />
      </div>
    </div>
  );

  // Filtre sans résultat : on garde la barre — sans elle, plus moyen d'effacer
  // ce qu'on vient de taper, et la page paraît vide et bloquée.
  if (visible.length === 0) {
    return (
      <div>
        {toolbar}
        <div className="rounded-xl border border-dashed border-default bg-raised/30 px-6 py-10 text-center">
          <p className="text-secondary">
            {searchingBeyond ? "Searching…" : `No match for “${filter.trim()}”.`}
          </p>
          <button
            type="button"
            onClick={() => setFilter("")}
            className="mt-3 rounded-lg border border-subtle bg-raised/40 px-3.5 py-1.5 text-small font-medium text-secondary transition-colors hover:border-default hover:text-primary"
          >
            Clear filter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {toolbar}

      {/* Below the breakpoint the table can't fit (8 columns need ~640px, or
          ~785px for pair rows) — same rows as stacked cards instead, in normal
          page flow so there's no scroll container nested inside the page
          scroll on a phone. */}
      <div className={cardsClass}>
        <div className="flex flex-col gap-2">
          {visible.slice(0, cardLimit).map((row, i) => {
            const tier = showBands ? tierMap.get(row.key)!.tier : null;
            const isNewBand = bandStarts.has(row.key);
            return (
              <Fragment key={row.key}>
                {isNewBand && tier && (
                  <div className={i === 0 ? "" : "mt-3"}>
                    <TierBandHeading tier={tier} />
                  </div>
                )}
                <MobileCard
                  row={row}
                  rank={i}
                  variant={variant}
                  tierInfo={variant === "tiers" ? tierMap.get(row.key) : undefined}
                  linkPrefix={linkPrefix}
                  linkSuffix={linkSuffix}
                  bestPlacement={bestPlacement}
                  worstPlacement={worstPlacement}
                  playRateLabel={playRateLabel}
                  hideTierBadge={showBands}
                />
              </Fragment>
            );
          })}
        </div>
        <ShowMoreButton
          shown={Math.min(cardLimit, visible.length)}
          total={visible.length}
          onClick={() => setCardLimit((n) => n + CARD_PAGE_SIZE)}
        />
      </div>

      {/* Bounded height + its own vertical scroll: sticky headers can only stick
          relative to a genuinely-scrolling ancestor (position:sticky computes
          against the nearest scroll container's own scrollport). An
          overflow-x-auto div with unconstrained height never actually scrolls
          internally, so a sticky child inside it just sits at a fixed
          `top` offset forever instead of reacting to scroll. */}
      <div
        className={`max-h-[75vh] overflow-auto overscroll-contain rounded-lg border border-subtle ${tableClass}`}
      >
        <table className={`w-full text-body ${compact ? "" : "min-w-[640px]"}`}>
          <thead>
            <tr className="text-left text-micro uppercase tracking-wide text-muted">
              <th className={`${stickyHeadCell} w-12 border-l-2 border-l-transparent pl-[14px] pr-4`}>
                #
              </th>
              {variant === "tiers" && !showBands && (
                <SortableHead
                  label="Tier"
                  sortKey="tier"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={cycleSort}
                  className={`${stickyHeadCell} w-14 px-4`}
                />
              )}
              {showRankColumn && (
                <SortableHead
                  label="Rank"
                  sortKey="rank"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={cycleSort}
                  className={`${stickyHeadCell} w-28 px-4`}
                />
              )}
              <th className={`${stickyHeadCell} px-4`}>Name</th>
              <SortableHead
                label={compact ? "Avg" : "Avg Placement"}
                sortKey="avgPlacement"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={cycleSort}
                align="right"
                className={`${stickyHeadCell} ${cellX} text-right`}
              />
              <SortableHead
                label="% Top 3"
                sortKey="top3Rate"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={cycleSort}
                align="right"
                className={`${stickyHeadCell} ${cellX} text-right`}
              />
              {variant === "tiers" && !compact && (
                <SortableHead
                  label="% Top 1"
                  sortKey="top1Rate"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={cycleSort}
                  align="right"
                  className={`${stickyHeadCell} ${cellX} text-right`}
                />
              )}
              <SortableHead
                label="Games"
                sortKey="games"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={cycleSort}
                align="right"
                className={`${stickyHeadCell} ${cellX} text-right`}
              />
              {variant === "tiers" && !compact && (
                <SortableHead
                  label={playRateLabel}
                  sortKey="playRate"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={cycleSort}
                  align="right"
                  className={`${stickyHeadCell} ${cellX} text-right`}
                />
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              const tier = showBands ? tierMap.get(row.key)!.tier : null;
              const isNewBand = bandStarts.has(row.key);
              return (
                <Fragment key={row.key}>
                  {isNewBand && tier && (
                    <TierBandRow tier={tier} colSpan={colCount} isFirst={i === 0} />
                  )}
                  <DataRow
                    row={row}
                    rank={i}
                    variant={variant}
                    tierMap={tierMap}
                    linkPrefix={linkPrefix}
                    linkSuffix={linkSuffix}
                    maxTop3={maxTop3}
                    maxTop1={maxTop1}
                    bestPlacement={bestPlacement}
                    worstPlacement={worstPlacement}
                    hideTierColumn={showBands}
                    showRankColumn={showRankColumn}
                    compact={compact}
                  />
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
