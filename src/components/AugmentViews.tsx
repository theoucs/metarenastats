"use client";

import { useState } from "react";
import { TieredStatsTabs, type StatsTab } from "@/components/TieredStatsTabs";
import { AugmentTimingGrid, type AugmentTimingRow } from "@/components/AugmentTimingGrid";
import { SlidingHighlight, useSlidingHighlight } from "@/components/SlidingHighlight";
import type { StatsRow } from "@/components/StatsTable";

type View = "tiers" | "timing";

const RARITY_TABS: StatsTab[] = [
  { key: "prismatic", label: "Prismatic" },
  { key: "gold", label: "Gold" },
  { key: "silver", label: "Silver" },
];

/**
 * Two different questions about the same augments, so two views rather than a
 * fourth rarity tab: "which augment is strongest" splits by rarity, "when
 * should I take it" deliberately doesn't. Stacking both axes into one tab strip
 * would ask the reader to hold two unrelated splits in their head at once.
 */
export function AugmentViews({
  rowsByRarity,
  timingRows,
  timingNote,
}: {
  rowsByRarity: Record<string, StatsRow[]>;
  timingRows: AugmentTimingRow[];
  timingNote: React.ReactNode;
}) {
  const [view, setView] = useState<View>("tiers");
  const { containerRef, register, rect } = useSlidingHighlight(view);

  return (
    <div>
      <div
        ref={containerRef}
        className="relative mb-5 inline-flex flex-wrap rounded-lg border border-subtle bg-inset p-1"
      >
        <SlidingHighlight rect={rect} />
        {(
          [
            { key: "tiers", label: "Tier list" },
            { key: "timing", label: "By pick order" },
          ] as const
        ).map((option) => (
          <button
            key={option.key}
            ref={register(option.key)}
            onClick={() => setView(option.key)}
            aria-pressed={view === option.key}
            className={`relative z-10 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              view === option.key ? "text-primary" : "text-muted hover:text-secondary"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {view === "tiers" ? (
        <TieredStatsTabs tabs={RARITY_TABS} rowsByTier={rowsByRarity} display="grid" />
      ) : (
        <div>
          {timingNote}
          <AugmentTimingGrid rows={timingRows} />
        </div>
      )}
    </div>
  );
}
