"use client";

import { useState } from "react";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { StatsGrid } from "@/components/StatsGrid";
import { SlidingHighlight, useSlidingHighlight } from "@/components/SlidingHighlight";

export type StatsTab = {
  key: string;
  label: string;
  /**
   * Renders the tab as a non-interactive "Soon" placeholder. Used where the
   * split is real and planned but the sample can't support it yet — see the
   * Team Comps page, where champion duos and trios are both waiting on data.
   */
  comingSoon?: boolean;
};

export function TieredStatsTabs({
  tabs,
  rowsByTier,
  linkPrefix,
  linkSuffix,
  playRateLabel,
  defaultTab,
  display = "table",
  unitLabel,
  gamesBonus,
}: {
  tabs: readonly StatsTab[];
  rowsByTier: Record<string, StatsRow[]>;
  linkPrefix?: string;
  linkSuffix?: string;
  playRateLabel?: string;
  /** Which tab key is active initially — defaults to the first enabled tab. */
  defaultTab?: string;
  /** "grid" for icon-led browsing (augments, items); "table" for rankings. */
  display?: "table" | "grid";
  /** What one row's `games` counts — see StatsGrid. */
  unitLabel?: string;
  /** See TierOptions — grid display only. */
  gamesBonus?: boolean;
}) {
  const [active, setActive] = useState(
    defaultTab ?? tabs.find((t) => !t.comingSoon)?.key ?? tabs[0].key
  );
  const { containerRef, register, rect } = useSlidingHighlight(active, tabs);

  return (
    <div>
      <div
        ref={containerRef}
        role="tablist"
        className="relative mb-4 inline-flex flex-wrap rounded-lg border border-subtle bg-inset p-1"
      >
        <SlidingHighlight rect={rect} />
        {tabs.map((tab) =>
          tab.comingSoon ? (
            <span
              key={tab.key}
              // A disabled <button> would still be a tab stop in some browsers
              // and reads as "broken control"; this is a label, so it's markup.
              className="relative z-10 flex cursor-not-allowed items-center gap-1.5 rounded-md px-3 py-1.5 text-small font-medium text-muted/60"
              title="Not enough matches tracked yet"
            >
              {tab.label}
              <span className="rounded-full border border-subtle px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-muted">
                Soon
              </span>
            </span>
          ) : (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active === tab.key}
              ref={register(tab.key)}
              onClick={() => setActive(tab.key)}
              className={`relative z-10 rounded-md px-3 py-1.5 text-small font-medium transition-[color,transform] duration-75 active:scale-[0.97] ${
                active === tab.key ? "text-primary" : "text-muted hover:text-secondary"
              }`}
            >
              {tab.label}
            </button>
          )
        )}
      </div>
      <div key={active} className="motion-safe:animate-[fade-in_150ms_ease-out]">
      {display === "grid" ? (
        <StatsGrid
          rows={rowsByTier[active] ?? []}
          playRateLabel={playRateLabel}
          unitLabel={unitLabel}
          gamesBonus={gamesBonus}
        />
      ) : (
        <StatsTable
          rows={rowsByTier[active] ?? []}
          linkPrefix={linkPrefix}
          linkSuffix={linkSuffix}
          playRateLabel={playRateLabel}
        />
      )}
      </div>
    </div>
  );
}
