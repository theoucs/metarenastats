import { getItemStats } from "@/lib/aggregate";
import { SampleSizeBadge, type StatsRow } from "@/components/StatsTable";
import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { resolveItem, itemCategory } from "@/lib/gameData";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "legendary", label: "Legendary" },
  { key: "prismatic", label: "Prismatic" },
] as const;

export default async function ItemsPage() {
  const { totalMatches, items } = await getItemStats(itemCategory);

  const rowsByTier: Record<string, StatsRow[]> = { legendary: [], prismatic: [] };
  for (const entry of items) {
    const info = resolveItem(entry.itemId);
    // Boots and the plain shop pool (no category tag) both count as
    // "Legendary" here — only Prismatic items get their own tab.
    const isPrismatic = itemCategory(entry.itemId) === "prismatic";
    const row: StatsRow = {
      key: String(entry.itemId),
      name: info?.name ?? `Item ${entry.itemId}`,
      iconUrl: info?.iconUrl,
      rarity: isPrismatic ? "prismatic" : undefined,
      games: entry.games,
      top3Rate: entry.top3Rate,
      top1Rate: entry.top1Rate,
      avgPlacement: entry.avgPlacement,
      playRate: entry.playRate,
    };
    rowsByTier[isPrismatic ? "prismatic" : "legendary"].push(row);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Item Tier List</h1>
      <p className="mt-2 text-zinc-400">Split by rarity.</p>
      <div className="mt-4 mb-6">
        <SampleSizeBadge totalMatches={totalMatches} />
      </div>
      <TieredStatsTabs tabs={TABS} rowsByTier={rowsByTier} />
    </div>
  );
}
