"use client";

import { useState } from "react";
import { StatsTable, type StatsRow } from "@/components/StatsTable";

export function TieredStatsTabs({
  tabs,
  rowsByTier,
  linkPrefix,
  playRateLabel,
}: {
  tabs: readonly { key: string; label: string }[];
  rowsByTier: Record<string, StatsRow[]>;
  linkPrefix?: string;
  playRateLabel?: string;
}) {
  const [active, setActive] = useState(tabs[0].key);

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              active === tab.key ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <StatsTable
        rows={rowsByTier[active] ?? []}
        linkPrefix={linkPrefix}
        playRateLabel={playRateLabel}
      />
    </div>
  );
}
