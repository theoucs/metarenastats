import { getItemStats } from "@/lib/aggregate";
import { StatsTable, SampleSizeBadge, type StatsRow } from "@/components/StatsTable";
import itemsData from "@/lib/data/items.json";

const itemsById = new Map(itemsData.map((i) => [i.id, i]));

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const { totalMatches, items } = await getItemStats();

  const rows: StatsRow[] = items.map((entry) => {
    const info = itemsById.get(entry.itemId);
    return {
      key: String(entry.itemId),
      name: info?.name ?? `Item ${entry.itemId}`,
      iconUrl: info?.iconUrl,
      games: entry.games,
      top3Rate: entry.top3Rate,
      top1Rate: entry.top1Rate,
      avgPlacement: entry.avgPlacement,
    };
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Item Tier List</h1>
      <p className="mt-2 text-zinc-400">
        % Top 3 and average placement for items across tracked Arena games.
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        Legendary / Mythic split is coming soon — showing all items together for now.
      </p>
      <div className="mt-4 mb-6">
        <SampleSizeBadge totalMatches={totalMatches} />
      </div>
      <StatsTable rows={rows} />
    </div>
  );
}
