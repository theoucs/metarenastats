import { getAnvilChampionStats } from "@/lib/aggregate";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { PageHeader } from "@/components/PageHeader";
import { resolveChampion, itemCategory } from "@/lib/gameData";

export const dynamic = "force-dynamic";

export default async function AnvilPage() {
  const { totalMatches, champions } = await getAnvilChampionStats(itemCategory);

  const rows: StatsRow[] = champions.map((c) => {
    const info = resolveChampion(c.champion);
    return {
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
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader
        eyebrow="Tier list"
        title="Anvil Run"
        isNew
        description="Best champions to play a full anvil run on — stat anvils only, no items bought. Click a champion for its full build page."
        totalMatches={totalMatches}
      />
      <StatsTable rows={rows} linkPrefix="/champions/" playRateLabel="% Anvil Run" />
    </div>
  );
}
