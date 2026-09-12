import { getChampionStats } from "@/lib/aggregate";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { PageHeader } from "@/components/PageHeader";
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
      playRate: c.playRate,
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader
        eyebrow="Tier list"
        title="Champions"
        description="Click a champion for its full build page."
        totalMatches={totalMatches}
      />
      <StatsTable rows={rows} linkPrefix="/champions/" />
    </div>
  );
}
