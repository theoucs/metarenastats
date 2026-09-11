"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { computeTiers, TIER_STYLES, type Tier, type TierInfo } from "@/lib/tiers";
import { top1Color, top3Color, EntityIcon, type EntityRarity } from "@/lib/statsDisplay";

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
  /** When set, the name cell renders as a "name + secondaryName" pair — used
   * for the Combos tier list (two items/augments picked together). */
  secondaryName?: string;
  secondaryIconUrl?: string;
  secondaryRarity?: EntityRarity;
};

type SortKey = "tier" | "top3Rate" | "top1Rate" | "avgPlacement" | "playRate";

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

function TierBadge({ tier }: { tier: Tier }) {
  const style = TIER_STYLES[tier];
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border font-display text-sm font-bold ${style.bg} ${style.text} ${style.border} ${style.glow}`}
    >
      {tier}
    </span>
  );
}

function TierBandRow({ tier, colSpan, isFirst }: { tier: Tier; colSpan: number; isFirst: boolean }) {
  const style = TIER_STYLES[tier];
  return (
    <tr aria-hidden="true">
      <td colSpan={colSpan} className={`px-4 pb-1.5 ${isFirst ? "pt-3" : "pt-5"}`}>
        <div
          className="flex items-center gap-2 text-micro font-semibold uppercase tracking-wide"
          style={{ color: style.hex }}
        >
          {tier} Tier
          <span className="h-px flex-1" style={{ backgroundColor: style.hex, opacity: 0.25 }} />
        </div>
      </td>
    </tr>
  );
}

function SortControl({
  sortBy,
  onChange,
  options,
}: {
  sortBy: SortKey;
  onChange: (s: SortKey) => void;
  options: { key: SortKey; label: string }[];
}) {
  return (
    <div className="mb-3 flex items-center gap-2 text-small">
      <span className="text-muted">Sort by:</span>
      <div className="inline-flex flex-wrap rounded-lg border border-subtle bg-inset p-1">
        {options.map((opt) => (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${
              sortBy === opt.key
                ? "bg-overlay text-primary shadow-[var(--elev-2)]"
                : "text-muted hover:text-secondary"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NameCellContent({ row }: { row: StatsRow }) {
  if (row.secondaryName) {
    return (
      <>
        {row.iconUrl && <EntityIcon iconUrl={row.iconUrl} rarity={row.rarity} sizeClass="h-9 w-9" />}
        <span className="font-medium text-primary">{row.name}</span>
        <span className="text-muted">+</span>
        {row.secondaryIconUrl && (
          <EntityIcon iconUrl={row.secondaryIconUrl} rarity={row.secondaryRarity} sizeClass="h-9 w-9" />
        )}
        <span className="font-medium text-primary">{row.secondaryName}</span>
      </>
    );
  }
  return (
    <>
      {row.iconUrl && <EntityIcon iconUrl={row.iconUrl} rarity={row.rarity} sizeClass="h-9 w-9" />}
      <span className="font-medium text-primary">{row.name}</span>
    </>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-subtle bg-raised/40 p-10 text-center text-secondary">
      No data yet. Search a player on the home page to start populating stats.
    </div>
  );
}

// Normalized-to-column-max bar width behind %Top3/%Top1, in percent of cell
// width — capped so it never touches the far edge, floored so a near-zero
// value still shows a visible sliver.
function meterWidth(value: number, max: number) {
  if (max <= 0) return 0;
  return Math.max(3, Math.min(92, (value / max) * 92));
}

const stickyHeadCell = "sticky top-0 z-30 border-b border-default bg-inset py-3 font-medium";

function DataRow({
  row,
  rank,
  variant,
  tierMap,
  linkPrefix,
  maxTop3,
  maxTop1,
}: {
  row: StatsRow;
  rank: number;
  variant: "tiers" | "ranked";
  tierMap: Map<string, TierInfo>;
  linkPrefix?: string;
  maxTop3: number;
  maxTop1: number;
}) {
  const tierInfo = variant === "tiers" ? tierMap.get(row.key) : undefined;
  const railHex = tierInfo ? TIER_STYLES[tierInfo.tier].hex : "transparent";

  return (
    <tr
      id={`entity-${row.key}`}
      className="group border-b border-subtle transition-colors duration-150 last:border-0 hover:bg-overlay"
      style={{ "--rail": railHex } as React.CSSProperties}
    >
      <td className="border-l-2 border-l-[color:var(--rail)] py-2.5 pl-[14px] pr-4 transition-colors duration-150 group-hover:border-l-[color:var(--accent)]">
        {variant === "ranked" ? (
          <RankCell rank={rank + 1} />
        ) : (
          <span className="font-mono tabular-nums text-muted">{rank + 1}</span>
        )}
      </td>
      {variant === "tiers" && (
        <td className="px-4 py-2.5">
          <TierBadge tier={tierMap.get(row.key)!.tier} />
        </td>
      )}
      <td className="px-4 py-2.5">
        {linkPrefix ? (
          <Link href={`${linkPrefix}${row.key}`} className="flex items-center gap-2.5 hover:underline">
            <NameCellContent row={row} />
          </Link>
        ) : (
          <div className="flex items-center gap-2.5">
            <NameCellContent row={row} />
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-secondary">{row.games}</td>
      <td className="relative px-4 py-2.5 text-right font-mono tabular-nums">
        <span
          aria-hidden="true"
          className="absolute inset-y-[7px] left-0 rounded-[3px] bg-[color:var(--accent-muted)]"
          style={{ width: `${meterWidth(row.top3Rate, maxTop3)}%` }}
        />
        <span className={`relative ${top3Color(row.top3Rate)}`}>{(row.top3Rate * 100).toFixed(1)}%</span>
      </td>
      {variant === "tiers" && (
        <td className="relative px-4 py-2.5 text-right font-mono tabular-nums">
          <span
            aria-hidden="true"
            className="absolute inset-y-[7px] left-0 rounded-[3px] bg-[color:var(--accent-muted)]"
            style={{ width: `${meterWidth(row.top1Rate, maxTop1)}%` }}
          />
          <span className={`relative ${top1Color(row.top1Rate)}`}>{(row.top1Rate * 100).toFixed(1)}%</span>
        </td>
      )}
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-secondary">
        {row.avgPlacement.toFixed(2)}
      </td>
      {variant === "tiers" && (
        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-secondary">
          {(row.playRate * 100).toFixed(1)}%
        </td>
      )}
    </tr>
  );
}

export function StatsTable({
  rows,
  variant = "tiers",
  linkPrefix,
  playRateLabel = "% Played",
}: {
  rows: StatsRow[];
  variant?: "tiers" | "ranked";
  /** When set, the name cell links to `${linkPrefix}${row.key}` — used for Champions -> champion detail page. */
  linkPrefix?: string;
  /** Column/sort label for `playRate` — its meaning (and denominator) varies by page. */
  playRateLabel?: string;
}) {
  const [sortBy, setSortBy] = useState<SortKey>(variant === "tiers" ? "tier" : "top3Rate");

  // Every row gets a fixed tier from the combined games/placement/top1/top3
  // rank, independent of whatever sort is currently selected.
  const tierMap = useMemo(() => computeTiers(rows), [rows]);

  const { maxTop3, maxTop1 } = useMemo(
    () => ({
      maxTop3: rows.reduce((m, r) => Math.max(m, r.top3Rate), 0),
      maxTop1: rows.reduce((m, r) => Math.max(m, r.top1Rate), 0),
    }),
    [rows]
  );

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sortBy === "top3Rate") {
      copy.sort((a, b) => b.top3Rate - a.top3Rate);
    } else if (sortBy === "top1Rate") {
      copy.sort((a, b) => b.top1Rate - a.top1Rate);
    } else if (sortBy === "avgPlacement") {
      copy.sort((a, b) => a.avgPlacement - b.avgPlacement);
    } else if (sortBy === "playRate") {
      copy.sort((a, b) => b.playRate - a.playRate);
    } else {
      copy.sort((a, b) => tierMap.get(a.key)!.score - tierMap.get(b.key)!.score);
    }
    return copy;
  }, [rows, sortBy, tierMap]);

  if (rows.length === 0) return <EmptyState />;

  const sortOptions: { key: SortKey; label: string }[] =
    variant === "tiers"
      ? [
          { key: "tier", label: "Tier" },
          { key: "top3Rate", label: "% Top 3" },
          { key: "top1Rate", label: "% Top 1" },
          { key: "avgPlacement", label: "Avg Placement" },
          { key: "playRate", label: playRateLabel },
        ]
      : [
          { key: "top3Rate", label: "% Top 3" },
          { key: "avgPlacement", label: "Avg Placement" },
        ];

  const colCount = variant === "tiers" ? 8 : 5;
  const showBands = variant === "tiers" && sortBy === "tier";

  let lastTier: Tier | null = null;

  return (
    <div>
      <SortControl sortBy={sortBy} onChange={setSortBy} options={sortOptions} />
      {/* Bounded height + its own vertical scroll: sticky headers can only stick
          relative to a genuinely-scrolling ancestor (position:sticky computes
          against the nearest scroll container's own scrollport). An
          overflow-x-auto div with unconstrained height never actually scrolls
          internally, so a sticky child inside it just sits at a fixed
          `top` offset forever instead of reacting to scroll. */}
      <div className="max-h-[75vh] overflow-auto overscroll-contain rounded-lg border border-subtle">
        <table className="w-full min-w-[640px] text-body">
          <thead>
            <tr className="text-left text-micro uppercase tracking-wide text-muted">
              <th className={`${stickyHeadCell} w-12 border-l-2 border-l-transparent pl-[14px] pr-4`}>
                #
              </th>
              {variant === "tiers" && <th className={`${stickyHeadCell} w-14 px-4`}>Tier</th>}
              <th className={`${stickyHeadCell} px-4`}>Name</th>
              <th className={`${stickyHeadCell} px-4 text-right`}>Games</th>
              <th className={`${stickyHeadCell} px-4 text-right`}>% Top 3</th>
              {variant === "tiers" && <th className={`${stickyHeadCell} px-4 text-right`}>% Top 1</th>}
              <th className={`${stickyHeadCell} px-4 text-right`}>Avg Placement</th>
              {variant === "tiers" && (
                <th className={`${stickyHeadCell} px-4 text-right`}>{playRateLabel}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const tier = showBands ? tierMap.get(row.key)!.tier : null;
              const isNewBand = showBands && tier !== lastTier;
              if (isNewBand) lastTier = tier;
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
                    maxTop3={maxTop3}
                    maxTop1={maxTop1}
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
