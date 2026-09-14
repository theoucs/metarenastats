"use client";

import { Fragment, useMemo, useState } from "react";
import { computeTiers, TIER_STYLES, type Tier } from "@/lib/tiers";

import {
  top1Color,
  top3Color,
  avgPlacementColor,
  EntityIcon,
  type EntityRarity,
} from "@/lib/statsDisplay";
import {
  CARD_PAGE_SIZE,
  RoleChips,
  EmptyState,
  ShowMoreButton,
  SortControl,
  TierBadge,
  TierBandHeading,
  placementMeterWidth,
  type SortKey,
  type StatsRow,
} from "@/components/StatsTable";
import { EntityTooltip, type EntityRef } from "@/components/EntityTooltip";

/**
 * Card-grid counterpart to StatsTable, for pages whose rows are *things you
 * browse* rather than *a ranking you scan*: augments and items, where the icon
 * (and its rarity frame) carries as much meaning as the numbers.
 *
 * This is deliberately a different shape from the tier-list tables — when
 * every page on the site is "H1 + pills + one bordered table", the site reads
 * as a template. Champions / Combos / Anvil / Leaderboard stay tables because
 * they genuinely are rankings; these two don't.
 */

/** Icône de carte, avec l'infobulle de description quand la ligne représente un
 *  item ou un augment. Sans `entity` (champions, joueurs, archétypes), l'icône
 *  est rendue telle quelle plutôt que d'ouvrir une bulle qui n'aurait rien à
 *  dire de plus que le nom déjà visible à côté. */
function GridTooltipIcon({
  entity,
  name,
  iconUrl,
  rarity,
  sizeClass,
}: {
  entity?: EntityRef;
  name: string;
  iconUrl: string;
  rarity?: EntityRarity;
  sizeClass: string;
}) {
  const icon = <EntityIcon iconUrl={iconUrl} rarity={rarity} sizeClass={sizeClass} />;
  if (!entity) return icon;
  return (
    <EntityTooltip entity={entity} name={name}>
      {icon}
    </EntityTooltip>
  );
}

function GridCard({
  row,
  rank,
  tier,
  bestPlacement,
  worstPlacement,
  playRateLabel,
  unitLabel,
  showTiming,
  hideTierBadge,
}: {
  row: StatsRow;
  rank: number;
  tier: Tier;
  bestPlacement: number;
  worstPlacement: number;
  playRateLabel: string;
  unitLabel: string;
  showTiming: boolean;
  /** Suppressed while tier bands are shown — the band right above already
   *  says the tier, so the badge is the same letter twice. */
  hideTierBadge: boolean;
}) {
  return (
    <article
      id={`entity-${row.key}`}
      className="group relative isolate overflow-hidden rounded-xl border border-subtle bg-raised/40 p-3.5 shadow-[var(--elev-1)] transition-[transform,border-color,background-color,box-shadow] duration-150 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(140px_70px_at_10%_0%,color-mix(in_srgb,var(--tier-hex)_16%,transparent),transparent)] hover:-translate-y-0.5 hover:border-default hover:bg-overlay hover:shadow-[var(--elev-2)] motion-reduce:hover:translate-y-0"
      style={{ "--tier-hex": TIER_STYLES[tier].hex } as React.CSSProperties}
    >
      {/* Tier rail: same left-edge language as the table rows, so the two
          layouts still read as one system. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-3 left-0 w-0.5 rounded-full"
        style={{ backgroundColor: TIER_STYLES[tier].hex, opacity: 0.7 }}
      />

      <div className="flex items-start gap-2.5">
        {!row.roles && !row.secondaryName && row.iconUrl && (
          <GridTooltipIcon
            entity={row.entity}
            name={row.name}
            iconUrl={row.iconUrl}
            rarity={row.rarity}
            sizeClass="h-11 w-11"
          />
        )}
        <div className="min-w-0 flex-1">
          {row.roles ? (
            <RoleChips roles={row.roles} />
          ) : row.secondaryName ? (
            // Pair rows (Combos-style) carry two entities. The icon moves inline
            // with each name here rather than sitting once at the card's left
            // edge, where it would silently belong to whichever half came first.
            <h3 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body font-medium leading-snug text-primary">
              <span className="flex min-w-0 items-center gap-1.5">
                {row.iconUrl && (
                  <GridTooltipIcon
                    entity={row.entity}
                    name={row.name}
                    iconUrl={row.iconUrl}
                    rarity={row.rarity}
                    sizeClass="h-7 w-7"
                  />
                )}
                {row.name}
              </span>
              <span className="text-muted">+</span>
              <span className="flex min-w-0 items-center gap-1.5">
                {row.secondaryIconUrl && (
                  <GridTooltipIcon
                    entity={row.secondaryEntity}
                    name={row.secondaryName ?? ""}
                    iconUrl={row.secondaryIconUrl}
                    rarity={row.secondaryRarity}
                    sizeClass="h-7 w-7"
                  />
                )}
                {row.secondaryName}
              </span>
            </h3>
          ) : (
            <h3 className="text-body font-medium leading-snug text-primary">{row.name}</h3>
          )}
          <p className="mt-1 font-mono text-micro tabular-nums text-muted">
            #{rank + 1} · {row.games} {unitLabel}
          </p>
        </div>
        {!hideTierBadge && <TierBadge tier={tier} />}
      </div>

      {/* Avg Placement is the headline number everywhere on this site — see
          docs/design-audit-plan.md §3.6. % Top 3 drops into the row below. */}
      <div className="mt-3.5 flex items-baseline justify-between gap-2">
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
        <div className="flex items-baseline gap-1">
          <dt>Top 1</dt>
          <dd className={top1Color(row.top1Rate)}>{(row.top1Rate * 100).toFixed(1)}%</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt>{playRateLabel.replace(/^%\s*/, "")}</dt>
          <dd className="text-secondary">{(row.playRate * 100).toFixed(1)}%</dd>
        </div>
        {/* Only while a timing sort is active — otherwise it's a fourth number
            on every card that most readers never asked for. */}
        {showTiming && row.timing && (
          <div
            className="flex items-baseline gap-1"
            title={`% Top 3 by pick: ${row.timing.rates
              .map((r) => `${(r * 100).toFixed(0)}%`)
              .join(" → ")}`}
          >
            <dt>{row.timing.swing >= 0 ? "Later" : "Earlier"}</dt>
            <dd className="text-secondary">
              +{Math.abs(row.timing.swing * 100).toFixed(0)}pp
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}

export function StatsGrid({
  rows,
  playRateLabel = "% Played",
  unitLabel = "games",
  gamesBonus = true,
}: {
  rows: StatsRow[];
  playRateLabel?: string;
  /** What one row's `games` counts — "games" for items/augments, "teams" for comps. */
  unitLabel?: string;
  /** See TierOptions — false where volume is structural, not chosen. */
  gamesBonus?: boolean;
}) {
  const [sortBy, setSortBy] = useState<SortKey>("tier");
  // Unlike the table, this grid isn't inside a bounded scrollport — every card
  // adds to page height, so it pages in like the mobile card list does.
  const [limit, setLimit] = useState(CARD_PAGE_SIZE);

  const tierMap = useMemo(() => computeTiers(rows, { gamesBonus }), [rows, gamesBonus]);
  // "best" is the *lowest* average placement, hence the flipped reduces.
  const { bestPlacement, worstPlacement } = useMemo(
    () => ({
      bestPlacement: rows.reduce((m, r) => Math.min(m, r.avgPlacement), Infinity),
      worstPlacement: rows.reduce((m, r) => Math.max(m, r.avgPlacement), 0),
    }),
    [rows]
  );

  const hasTiming = useMemo(() => rows.some((r) => r.timing), [rows]);
  const showTiming = sortBy === "later" || sortBy === "earlier";

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sortBy === "top3Rate") copy.sort((a, b) => b.top3Rate - a.top3Rate);
    else if (sortBy === "top1Rate") copy.sort((a, b) => b.top1Rate - a.top1Rate);
    else if (sortBy === "avgPlacement") copy.sort((a, b) => a.avgPlacement - b.avgPlacement);
    else if (sortBy === "playRate") copy.sort((a, b) => b.playRate - a.playRate);
    else if (sortBy === "later" || sortBy === "earlier") {
      // Augments without enough picks in all three slots have no swing at all;
      // they sink to the bottom rather than being silently dropped, so the tab
      // still shows every augment whichever sort is active.
      const sign = sortBy === "later" ? 1 : -1;
      copy.sort((a, b) => {
        if (!a.timing) return b.timing ? 1 : 0;
        if (!b.timing) return -1;
        return sign * (b.timing.swing - a.timing.swing);
      });
    } else copy.sort((a, b) => tierMap.get(b.key)!.score - tierMap.get(a.key)!.score);
    return copy;
  }, [rows, sortBy, tierMap]);

  if (rows.length === 0) {
    return <EmptyState />;
  }

  const showBands = sortBy === "tier";
  let lastTier: Tier | null = null;

  return (
    <div>
      <SortControl
        sortBy={sortBy}
        onChange={(s) => {
          setSortBy(s);
          setLimit(CARD_PAGE_SIZE);
        }}
        options={[
          { key: "tier", label: "Tier" },
          { key: "top3Rate", label: "% Top 3" },
          { key: "top1Rate", label: "% Top 1" },
          { key: "avgPlacement", label: "Avg Placement" },
          { key: "playRate", label: playRateLabel },
          ...(hasTiming
            ? ([
                { key: "earlier", label: "Better early" },
                { key: "later", label: "Better late" },
              ] as const)
            : []),
        ]}
      />
      {/* Bands are full-width rules between grid rows, so the grid has to be
          the direct parent of both — hence `col-span-full` rather than a
          wrapper per band. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.slice(0, limit).map((row, i) => {
          const tier = tierMap.get(row.key)!.tier;
          const isNewBand = showBands && tier !== lastTier;
          if (isNewBand) lastTier = tier;
          return (
            <Fragment key={row.key}>
              {isNewBand && (
                <div className={`col-span-full ${i === 0 ? "" : "mt-3"}`}>
                  <TierBandHeading tier={tier} />
                </div>
              )}
              <GridCard
                row={row}
                rank={i}
                tier={tier}
                bestPlacement={bestPlacement}
                worstPlacement={worstPlacement}
                hideTierBadge={showBands}
                playRateLabel={playRateLabel}
                unitLabel={unitLabel}
                showTiming={showTiming}
              />
            </Fragment>
          );
        })}
      </div>
      <ShowMoreButton
        shown={Math.min(limit, sorted.length)}
        total={sorted.length}
        onClick={() => setLimit((n) => n + CARD_PAGE_SIZE)}
      />
    </div>
  );
}
