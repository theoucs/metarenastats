"use client";

import { useMemo, useState } from "react";
import { computeTiers, TIER_ORDER, TIER_STYLES } from "@/lib/tiers";

export type StatsRow = {
  key: string;
  name: string;
  iconUrl?: string;
  games: number;
  winRate: number;
  avgPlacement: number;
};

type SortKey = "winRate" | "avgPlacement";

function winRateColor(winRate: number) {
  if (winRate >= 0.55) return "text-emerald-400";
  if (winRate >= 0.4) return "text-zinc-200";
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

function sortRows(rows: StatsRow[], sortBy: SortKey) {
  const copy = [...rows];
  if (sortBy === "winRate") {
    copy.sort((a, b) => b.winRate - a.winRate);
  } else {
    copy.sort((a, b) => a.avgPlacement - b.avgPlacement);
  }
  return copy;
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

function SortControl({ sortBy, onChange }: { sortBy: SortKey; onChange: (s: SortKey) => void }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-sm">
      <span className="text-zinc-500">Sort by:</span>
      <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
        {(
          [
            { key: "winRate", label: "Win Rate" },
            { key: "avgPlacement", label: "Avg Placement" },
          ] as const
        ).map((opt) => (
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

function Row({ row, rank, showMedal }: { row: StatsRow; rank: number; showMedal: boolean }) {
  return (
    <tr
      id={`entity-${row.key}`}
      className="border-b border-zinc-900 last:border-0 hover:bg-zinc-900/40"
    >
      <td className="px-4 py-2.5">
        {showMedal ? <RankCell rank={rank} /> : <span className="font-mono text-zinc-500">{rank}</span>}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          {row.iconUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.iconUrl}
              alt=""
              className="h-7 w-7 rounded-md border border-zinc-800 object-cover"
            />
          )}
          <span className="font-medium text-zinc-100">{row.name}</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{row.games}</td>
      <td className={`px-4 py-2.5 text-right font-mono ${winRateColor(row.winRate)}`}>
        {(row.winRate * 100).toFixed(1)}%
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-zinc-400">
        {row.avgPlacement.toFixed(2)}
      </td>
    </tr>
  );
}

function TableHead() {
  return (
    <thead>
      <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
        <th className="w-12 px-4 py-3 font-medium">#</th>
        <th className="px-4 py-3 font-medium">Name</th>
        <th className="px-4 py-3 text-right font-medium">Games</th>
        <th className="px-4 py-3 text-right font-medium">Win Rate</th>
        <th className="px-4 py-3 text-right font-medium">Avg Placement</th>
      </tr>
    </thead>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-10 text-center text-zinc-500">
      No data yet. Search a player on the home page to start populating stats.
    </div>
  );
}

/** Flat ranked table (Leaderboard) — plain rank order with medals for the top 3. */
function RankedTable({ rows, sortBy }: { rows: StatsRow[]; sortBy: SortKey }) {
  const sorted = useMemo(() => sortRows(rows, sortBy), [rows, sortBy]);
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <TableHead />
        <tbody>
          {sorted.map((row, i) => (
            <Row key={row.key} row={row} rank={i + 1} showMedal />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Grouped by a fixed power tier (S/A/B/C/D), computed once from the combined
 * win-rate + avg-placement ranking — tier membership does NOT change when you
 * flip the sort toggle, only the order of rows within each band does.
 */
function TieredTable({ rows, sortBy }: { rows: StatsRow[]; sortBy: SortKey }) {
  const tierMap = useMemo(() => computeTiers(rows), [rows]);

  const groups = useMemo(() => {
    const byTier = new Map<string, StatsRow[]>();
    for (const row of rows) {
      const tier = tierMap.get(row.key)!;
      (byTier.get(tier) ?? byTier.set(tier, []).get(tier)!).push(row);
    }
    return TIER_ORDER.filter((t) => byTier.has(t)).map((tier) => ({
      tier,
      rows: sortRows(byTier.get(tier)!, sortBy),
    }));
  }, [rows, sortBy, tierMap]);

  let runningRank = 0;

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ tier, rows: tierRows }) => {
        const style = TIER_STYLES[tier];
        return (
          <div
            key={tier}
            className={`overflow-hidden rounded-lg border ${style.border} ${style.glow}`}
          >
            <div className={`flex items-center gap-2 border-b ${style.border} ${style.bg} px-4 py-2`}>
              <span className={`text-sm font-bold tracking-wide ${style.text}`}>{tier} TIER</span>
              <span className="text-xs text-zinc-500">
                {tierRows.length} entr{tierRows.length === 1 ? "y" : "ies"}
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {tierRows.map((row) => {
                  runningRank += 1;
                  return <Row key={row.key} row={row} rank={runningRank} showMedal={false} />;
                })}
              </tbody>
            </table>
          </div>
        );
      })}
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
  const [sortBy, setSortBy] = useState<SortKey>("winRate");

  if (rows.length === 0) return <EmptyState />;

  return (
    <div>
      <SortControl sortBy={sortBy} onChange={setSortBy} />
      {variant === "ranked" ? (
        <RankedTable rows={rows} sortBy={sortBy} />
      ) : (
        <TieredTable rows={rows} sortBy={sortBy} />
      )}
    </div>
  );
}
