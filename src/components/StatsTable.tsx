export type StatsRow = {
  key: string;
  name: string;
  iconUrl?: string;
  games: number;
  winRate: number;
  avgPlacement: number;
};

function winRateColor(winRate: number) {
  if (winRate >= 0.55) return "text-emerald-400";
  if (winRate >= 0.4) return "text-zinc-200";
  return "text-red-400";
}

export function SampleSizeBadge({ totalGames }: { totalGames: number }) {
  return (
    <span className="rounded-full border border-amber-900/50 bg-amber-950/40 px-3 py-1 text-xs text-amber-300">
      Sample size: {totalGames} game{totalGames === 1 ? "" : "s"} tracked so far — data grows with
      every search
    </span>
  );
}

export function StatsTable({ rows }: { rows: StatsRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-10 text-center text-zinc-500">
        No data yet. Search a player on the home page to start populating stats.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
            <th className="w-12 px-4 py-3 font-medium">#</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 text-right font-medium">Games</th>
            <th className="px-4 py-3 text-right font-medium">Win Rate</th>
            <th className="px-4 py-3 text-right font-medium">Avg Placement</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.key}
              id={`entity-${row.key}`}
              className="border-b border-zinc-900 last:border-0 hover:bg-zinc-900/40"
            >
              <td className="px-4 py-2.5 font-mono text-zinc-500">{i + 1}</td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
