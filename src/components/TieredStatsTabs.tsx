"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { StatsGrid } from "@/components/StatsGrid";

export function TieredStatsTabs({
  tabs,
  rowsByTier,
  linkPrefix,
  playRateLabel,
  defaultTab,
  display = "table",
}: {
  tabs: readonly { key: string; label: string }[];
  rowsByTier: Record<string, StatsRow[]>;
  linkPrefix?: string;
  playRateLabel?: string;
  /** Which tab key is active initially — defaults to the first tab. */
  defaultTab?: string;
  /** "grid" for icon-led browsing (augments, items); "table" for rankings. */
  display?: "table" | "grid";
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0].key);
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [highlight, setHighlight] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = btnRefs.current.get(active);
    setHighlight(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [active, tabs]);

  return (
    <div>
      <div className="relative mb-4 inline-flex rounded-lg border border-subtle bg-inset p-1">
        {highlight && (
          <div
            className="absolute inset-y-1 z-0 rounded-md bg-overlay shadow-[var(--elev-2)] transition-[left,width] duration-[250ms] ease-out motion-reduce:transition-none"
            style={{ left: highlight.left, width: highlight.width }}
          />
        )}
        {tabs.map((tab) => (
          <button
            key={tab.key}
            ref={(el) => {
              if (el) btnRefs.current.set(tab.key, el);
              else btnRefs.current.delete(tab.key);
            }}
            onClick={() => setActive(tab.key)}
            className={`relative z-10 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              active === tab.key ? "text-primary" : "text-muted hover:text-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {display === "grid" ? (
        <StatsGrid rows={rowsByTier[active] ?? []} playRateLabel={playRateLabel} />
      ) : (
        <StatsTable
          rows={rowsByTier[active] ?? []}
          linkPrefix={linkPrefix}
          playRateLabel={playRateLabel}
        />
      )}
    </div>
  );
}
