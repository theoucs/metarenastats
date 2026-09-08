"use client";

import { useMemo, useState } from "react";
import { computeTiers, TIER_STYLES } from "@/lib/tiers";

export type StatsRow = {
  key: string;
  name: string;
  iconUrl?: string;
  games: number;
  top3Rate: number;
  top1Rate: number;
  avgPlacement: number;
  /** Augment rarity (silver/gold/prismatic) — colors the icon frame like in-game. */
  rarity?: "silver" | "gold" | "prismatic";
};

type SortKey = "tier" | "top3Rate" | "top1Rate" | "avgPlacement";

function rateColor(rate: number) {
  if (rate >= 0.55) return "text-emerald-400";
  if (rate >= 0.4) return "text-zinc-200";
  return "text-red-400";
}

export function SampleSizeBadge({ totalMatches }: { totalMatches: number }) {
  return (
    <span className="rounded-full border border-zinc-700 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-400">
      Sample size: {totalMatches} match{totalMatches === 1 ? "" : "es"} tracked so far — data
      grows with every search
    </span>
  );
}

const MEDALS: Record<number, { bg: string; text: string; ring: string }> = {
  1: { bg: "bg-amber-400", text: "text-zinc-900", ring: "ring-amber-400/40" },
  2: { bg: "bg-zinc-300", text: "text-zinc-900", ring: "ring-zinc-300/40" },
  3: { bg: "bg-amber-700", text: "text-amber-50", ring: "ring-amber-700/40" },
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
  return <span className="font-mono text-zinc-500">{rank}</span>;
}

function TierBadge({ tier }: { tier: "S" | "A" | "B" | "C" | "D" }) {
  const style = TIER_STYLES[tier];
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border text-xs font-bold ${style.bg} ${style.text} ${style.border}`}
    >
      {tier}
    </span>
  );
}

// Matches the in-game augment rarity frame colors — silver/gold border, a
// holo gradient ring for prismatic (plain items/champions get a neutral border).
const RARITY_BORDER: Record<string, string> = {
  silver: "border-2 border-slate-300/70",
  gold: "border-2 border-amber-400/90",
};

function EntityIcon({ iconUrl, rarity }: { iconUrl: string; rarity?: StatsRow["rarity"] }) {
  if (rarity === "prismatic") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-fuchsia-400 via-purple-400 to-cyan-300 p-[2px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconUrl} alt="" className="h-full w-full rounded-[4px] object-cover" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl}
      alt=""
      className={`h-7 w-7 shrink-0 rounded-md object-cover ${
        rarity ? RARITY_BORDER[rarity] : "border border-zinc-800"
      }`}
    />
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
    <div className="mb-3 flex items-center gap-2 text-sm">
      <span className="text-zinc-500">Sort by:</span>
      <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
        {options.map((opt) => (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${
              sortBy === opt.key ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-10 text-center text-zinc-500">
      No data yet. Search a player on the home page to start populating stats.
    </div>
  );
}

export function StatsTable({
  rows,
  variant = "tiers",
}: {
  rows: StatsRow[];
  variant?: "tiers" | "ranked";
}) {
  const [sortBy, setSortBy] = useState<SortKey>(variant === "tiers" ? "tier" : "top3Rate");

  // Every row gets a fixed tier from the combined games/placement/top1/top3
  // rank, independent of whatever sort is currently selected.
  const tierMap = useMemo(() => computeTiers(rows), [rows]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sortBy === "top3Rate") {
      copy.sort((a, b) => b.top3Rate - a.top3Rate);
    } else if (sortBy === "top1Rate") {
      copy.sort((a, b) => b.top1Rate - a.top1Rate);
    } else if (sortBy === "avgPlacement") {
      copy.sort((a, b) => a.avgPlacement - b.avgPlacement);
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
        ]
      : [
          { key: "top3Rate", label: "% Top 3" },
          { key: "avgPlacement", label: "Avg Placement" },
        ];

  return (
    <div>
      <SortControl sortBy={sortBy} onChange={setSortBy} options={sortOptions} />
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="w-12 px-4 py-3 font-medium">#</th>
              {variant === "tiers" && <th className="w-14 px-4 py-3 font-medium">Tier</th>}
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 text-right font-medium">Games</th>
              <th className="px-4 py-3 text-right font-medium">% Top 3</th>
              {variant === "tiers" && (
                <th className="px-4 py-3 text-right font-medium">% Top 1</th>
              )}
              <th className="px-4 py-3 text-right font-medium">Avg Placement</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.key}
                id={`entity-${row.key}`}
                className="border-b border-zinc-900 last:border-0 hover:bg-zinc-900/40"
              >
                <td className="px-4 py-2.5">
                  {variant === "ranked" ? (
                    <RankCell rank={i + 1} />
                  ) : (
                    <span className="font-mono text-zinc-500">{i + 1}</span>
                  )}
                </td>
                {variant === "tiers" && (
                  <td className="px-4 py-2.5">
                    <TierBadge tier={tierMap.get(row.key)!.tier} />
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    {row.iconUrl && <EntityIcon iconUrl={row.iconUrl} rarity={row.rarity} />}
                    <span className="font-medium text-zinc-100">{row.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{row.games}</td>
                <td className={`px-4 py-2.5 text-right font-mono ${rateColor(row.top3Rate)}`}>
                  {(row.top3Rate * 100).toFixed(1)}%
                </td>
                {variant === "tiers" && (
                  <td className={`px-4 py-2.5 text-right font-mono ${rateColor(row.top1Rate)}`}>
                    {(row.top1Rate * 100).toFixed(1)}%
                  </td>
                )}
                <td className="px-4 py-2.5 text-right font-mono text-zinc-400">
                  {row.avgPlacement.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
