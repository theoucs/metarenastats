"use client";

import { useMemo, useState } from "react";
import { EntityIcon, type EntityRarity } from "@/lib/statsDisplay";
import { CARD_PAGE_SIZE, ShowMoreButton, SortControl } from "@/components/StatsTable";

export type AugmentTimingRow = {
  key: string;
  name: string;
  iconUrl?: string;
  rarity?: EntityRarity;
  totalPicks: number;
  slots: { slot: number; picks: number; top3Rate: number }[];
  swing: number;
};

/**
 * Ordinal ramp for the three pick slots — one hue (--accent), dim to bright.
 *
 * Dim→bright rather than light→dark because the surface is dark: "more" has to
 * mean "more luminous" here or the last step disappears into the card. The
 * three steps are the accent composited onto the card surface at 34/62/100%,
 * and they clear the skill's ordinal checks (monotone lightness, adjacent ΔL
 * ≥ 0.06, light end 2.16:1 on #0e1014, hue spread 3°).
 *
 * Slot order is a real ordinal scale (1st → 3rd pick), which is what makes a
 * ramp legitimate here rather than a value-ramp on nominal categories.
 */
const SLOT_RAMP = ["#1b515c", "#268797", "#35d0e8"];

const SLOT_LABELS = ["1st", "2nd", "3rd"];

/** 3 of 6 teams finish top 3, so half of every pick population does too. */
const TOP3_BASELINE = 0.5;

type TimingSort = "later" | "earlier" | "picks";

function SwingBadge({ swing }: { swing: number }) {
  const points = Math.abs(swing * 100);
  // No color on this: "better early" is not bad, so the site's reserved
  // green/red (which mean good/bad) would actively mislead, and inventing a
  // diverging pair would add two hues the design system doesn't have. The
  // direction is carried by the word and by the sort order.
  const label = swing >= 0 ? "Better late" : "Better early";
  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      <span className="text-micro font-medium uppercase tracking-wide text-secondary">{label}</span>
      <span className="font-mono text-micro tabular-nums text-muted">
        {points.toFixed(0)}pp
      </span>
    </span>
  );
}

function SlotBar({
  slot,
  picks,
  top3Rate,
  rampIndex,
}: {
  slot: number;
  picks: number;
  top3Rate: number;
  rampIndex: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-6 shrink-0 font-mono text-micro tabular-nums text-muted">
        {SLOT_LABELS[slot - 1]}
      </span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-[2px] bg-inset">
        <div
          // Square at the baseline, 4px rounded at the data end.
          className="h-full rounded-r-[4px]"
          style={{ width: `${Math.max(2, top3Rate * 100)}%`, backgroundColor: SLOT_RAMP[rampIndex] }}
        />
        {/* The 50% reference — hairline, solid, recessive. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-[color:var(--border-strong)]"
          style={{ left: `${TOP3_BASELINE * 100}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-micro tabular-nums text-secondary">
        {(top3Rate * 100).toFixed(0)}%
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-micro tabular-nums text-muted">
        n={picks}
      </span>
    </div>
  );
}

function TimingCard({ row }: { row: AugmentTimingRow }) {
  return (
    <article className="rounded-xl border border-subtle bg-raised/40 p-3.5 shadow-[var(--elev-1)]">
      <div className="flex items-start gap-2.5">
        {row.iconUrl && (
          <EntityIcon iconUrl={row.iconUrl} rarity={row.rarity} sizeClass="h-10 w-10" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-medium leading-snug text-primary">{row.name}</h3>
          <p className="mt-0.5 font-mono text-micro tabular-nums text-muted">
            {row.totalPicks} picks
          </p>
        </div>
        <SwingBadge swing={row.swing} />
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {row.slots.map((s, i) => (
          <SlotBar key={s.slot} slot={s.slot} picks={s.picks} top3Rate={s.top3Rate} rampIndex={i} />
        ))}
      </div>
    </article>
  );
}

export function AugmentTimingGrid({ rows }: { rows: AugmentTimingRow[] }) {
  const [sortBy, setSortBy] = useState<TimingSort>("later");
  const [limit, setLimit] = useState(CARD_PAGE_SIZE);

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sortBy === "earlier") copy.sort((a, b) => a.swing - b.swing);
    else if (sortBy === "picks") copy.sort((a, b) => b.totalPicks - a.totalPicks);
    else copy.sort((a, b) => b.swing - a.swing);
    return copy;
  }, [rows, sortBy]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-subtle bg-raised/40 p-10 text-center text-secondary">
        Not enough picks tracked yet to compare augments across pick slots.
      </div>
    );
  }

  return (
    <div>
      <SortControl<TimingSort>
        sortBy={sortBy}
        onChange={(next) => {
          setSortBy(next);
          setLimit(CARD_PAGE_SIZE);
        }}
        options={[
          { key: "later", label: "Best held for later" },
          { key: "earlier", label: "Best taken early" },
          { key: "picks", label: "Most picked" },
        ]}
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {sorted.slice(0, limit).map((row) => (
          <TimingCard key={row.key} row={row} />
        ))}
      </div>
      <ShowMoreButton
        shown={Math.min(limit, sorted.length)}
        total={sorted.length}
        onClick={() => setLimit((n) => n + CARD_PAGE_SIZE)}
      />
    </div>
  );
}
