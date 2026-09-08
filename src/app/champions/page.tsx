import { getChampionStats } from "@/lib/aggregate";
import { StatsTable, SampleSizeBadge, type StatsRow } from "@/components/StatsTable";
import { resolveChampion } from "@/lib/gameData";

export const dynamic = "force-dynamic";

export default async function ChampionsPage() {
  const { totalMatches, champions } = await getChampionStats();

  const rows: StatsRow[] = champions.map((c) => {
    const info = resolveChampion(c.champion);
    return {
      // Use Data Dragon's canonical casing as the key so search-result anchor
      // links (which are built from the same reference data) land on the
      // right row — falls back to the raw value if we don't recognize it.
      key: info?.id ?? c.champion,
      name: info?.name ?? c.champion,
      iconUrl: info?.iconUrl,
      games: c.games,
      top3Rate: c.top3Rate,
      top1Rate: c.top1Rate,
      avgPlacement: c.avgPlacement,
    };
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Champion Tier List</h1>
      <p className="mt-2 text-zinc-400">
        % Top 3 and average placement across tracked Arena games, ranked highest % Top 3 first.
      </p>
      <div className="mt-4 mb-6">
        <SampleSizeBadge totalMatches={totalMatches} />
      </div>
      <StatsTable rows={rows} />
    </div>
  );
}
