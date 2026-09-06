"use client";

import { useState } from "react";
import { StatsTable, type StatsRow } from "@/components/StatsTable";

const TIERS = [
  { key: "prismatic", label: "Prismatic" },
  { key: "gold", label: "Gold" },
  { key: "silver", label: "Silver" },
] as const;

export function AugmentTabs({
  rowsByTier,
}: {
  rowsByTier: Record<string, StatsRow[]>;
}) {
  const [active, setActive] = useState<(typeof TIERS)[number]["key"]>("prismatic");

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
        {TIERS.map((tier) => (
          <button
            key={tier.key}
            onClick={() => setActive(tier.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              active === tier.key
                ? "bg-blue-600 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tier.label}
          </button>
        ))}
      </div>
      <StatsTable rows={rowsByTier[active] ?? []} />
    </div>
  );
}
