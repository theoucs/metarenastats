"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { computeTiers, TIER_STYLES, type Tier, type TierInfo } from "@/lib/tiers";
import { top1Color, top3Color, EntityIcon, type EntityRarity } from "@/lib/statsDisplay";
import { SlidingHighlight, useSlidingHighlight } from "@/components/SlidingHighlight";

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
  /** When set, the name cell renders these as chips instead of icon + name —
   * used by Team Comps, whose "entity" is three champion classes with no art
   * of their own. Takes precedence over name/iconUrl. */
  roles?: string[];
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

export type SortKey = "tier" | "top3Rate" | "top1Rate" | "avgPlacement" | "playRate";

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
      className="mt-3 w-full rounded-lg border border-subtle bg-raised/40 py-2.5 text-small font-medium text-secondary transition-colors hover:border-default hover:bg-overlay hover:text-primary"
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
      className="flex items-center gap-2 text-micro font-semibold uppercase tracking-wide"
      style={{ color: style.hex }}
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

export function SortControl({
  sortBy,
  onChange,
  options,
}: {
  sortBy: SortKey;
  onChange: (s: SortKey) => void;
  options: { key: SortKey; label: string }[];
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
            className={`relative z-10 rounded-md px-3 py-1 font-medium transition-colors ${
              sortBy === opt.key ? "text-primary" : "text-muted hover:text-secondary"
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
  if (row.roles) return <RoleChips roles={row.roles} />;
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
export function meterWidth(value: number, max: number) {
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
  maxTop3,
  playRateLabel,
}: {
  row: StatsRow;
  rank: number;
  variant: "tiers" | "ranked";
  tierInfo?: TierInfo;
  linkPrefix?: string;
  maxTop3: number;
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
        {row.iconUrl && <EntityIcon iconUrl={row.iconUrl} rarity={row.rarity} sizeClass="h-8 w-8" />}
        <span className="min-w-0 break-words font-medium text-primary">{row.name}</span>
      </span>
      {row.secondaryName && (
        <>
          <span className="text-muted">+</span>
          <span className="flex min-w-0 items-center gap-2">
            {row.secondaryIconUrl && (
              <EntityIcon
                iconUrl={row.secondaryIconUrl}
                rarity={row.secondaryRarity}
                sizeClass="h-8 w-8"
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
          {variant === "ranked" ? <RankCell rank={rank + 1} /> : rank + 1}
        </span>
        {linkPrefix ? (
          <Link href={`${linkPrefix}${row.key}`} className="flex min-w-0 flex-1">
            {heading}
          </Link>
        ) : (
          heading
        )}
        {tierInfo && <TierBadge tier={tierInfo.tier} />}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className={`font-display text-h1 font-semibold ${top3Color(row.top3Rate)}`}>
          {(row.top3Rate * 100).toFixed(1)}%
        </span>
        <span className="text-micro uppercase tracking-wide text-muted">% Top 3</span>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-1 overflow-hidden rounded-full bg-inset">
        <div
          className="h-full rounded-full bg-[color:var(--accent)]/45"
          style={{ width: `${meterWidth(row.top3Rate, maxTop3)}%` }}
        />
      </div>

      <dl className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-micro tabular-nums text-muted">
        {variant === "tiers" && (
          <div className="flex items-baseline gap-1">
            <dt>Top 1</dt>
            <dd className={top1Color(row.top1Rate)}>{(row.top1Rate * 100).toFixed(1)}%</dd>
          </div>
        )}
        <div className="flex items-baseline gap-1">
          <dt>Avg</dt>
          <dd className="text-secondary">{row.avgPlacement.toFixed(2)}</dd>
        </div>
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
  // Mobile-only: see CARD_PAGE_SIZE. Reset from the sort handler rather than an
  // effect — re-sorting reshuffles which rows are "the first 40", so keeping an
  // expanded count would silently change what the button means.
  const [cardLimit, setCardLimit] = useState(CARD_PAGE_SIZE);

  // Every row gets a fixed tier from the combined games/placement/top1/top3
  // score, independent of whatever sort is currently selected.
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
      copy.sort((a, b) => tierMap.get(b.key)!.score - tierMap.get(a.key)!.score);
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

  let lastMobileTier: Tier | null = null;

  return (
    <div>
      <SortControl
        sortBy={sortBy}
        onChange={(s) => {
          setSortBy(s);
          setCardLimit(CARD_PAGE_SIZE);
        }}
        options={sortOptions}
      />

      {/* Under md the table can't fit (8 columns need ~640px) — same rows as
          stacked cards instead, in normal page flow so there's no scroll
          container nested inside the page scroll on a phone. */}
      <div className="md:hidden">
        <div className="flex flex-col gap-2">
          {sorted.slice(0, cardLimit).map((row, i) => {
            const tier = showBands ? tierMap.get(row.key)!.tier : null;
            const isNewBand = showBands && tier !== lastMobileTier;
            if (isNewBand) lastMobileTier = tier;
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
                  maxTop3={maxTop3}
                  playRateLabel={playRateLabel}
                />
              </Fragment>
            );
          })}
        </div>
        <ShowMoreButton
          shown={Math.min(cardLimit, sorted.length)}
          total={sorted.length}
          onClick={() => setCardLimit((n) => n + CARD_PAGE_SIZE)}
        />
      </div>

      {/* Bounded height + its own vertical scroll: sticky headers can only stick
          relative to a genuinely-scrolling ancestor (position:sticky computes
          against the nearest scroll container's own scrollport). An
          overflow-x-auto div with unconstrained height never actually scrolls
          internally, so a sticky child inside it just sits at a fixed
          `top` offset forever instead of reacting to scroll. */}
      <div className="hidden max-h-[75vh] overflow-auto overscroll-contain rounded-lg border border-subtle md:block">
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
