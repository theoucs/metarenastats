import { getItemStats } from "@/lib/aggregate";
import { type StatsRow } from "@/components/StatsTable";
import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { PageHeader } from "@/components/PageHeader";
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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader
        eyebrow="Tier list"
        title="Items"
        description="Split by rarity."
        totalMatches={totalMatches}
      />
      <TieredStatsTabs tabs={TABS} rowsByTier={rowsByTier} display="grid" />
    </div>
  );
}
