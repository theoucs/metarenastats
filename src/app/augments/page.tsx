import { getAugmentStats } from "@/lib/aggregate";
import { SampleSizeBadge, type StatsRow } from "@/components/StatsTable";
import { AugmentTabs } from "@/components/AugmentTabs";
import { resolveAugment } from "@/lib/gameData";

export const dynamic = "force-dynamic";

export default async function AugmentsPage() {
  const { totalMatches, augments } = await getAugmentStats();

  const rowsByTier: Record<string, StatsRow[]> = { silver: [], gold: [], prismatic: [] };
  for (const entry of augments) {
    const info = resolveAugment(entry.augmentId);
    const tier = info?.tier ?? "gold";
    const row: StatsRow = {
      key: String(entry.augmentId),
      name: info?.name ?? `Augment ${entry.augmentId}`,
      iconUrl: info?.iconUrl,
      rarity: tier as StatsRow["rarity"],
      games: entry.games,
      top3Rate: entry.top3Rate,
      top1Rate: entry.top1Rate,
      avgPlacement: entry.avgPlacement,
      playRate: entry.playRate,
    };
    (rowsByTier[tier] ??= []).push(row);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Augment Tier List</h1>
      <p className="mt-2 text-zinc-400">
        % Top 3 and average placement per augment, split by rarity.
      </p>
      <div className="mt-4 mb-6">
        <SampleSizeBadge totalMatches={totalMatches} />
      </div>
      <AugmentTabs rowsByTier={rowsByTier} />
    </div>
  );
}
