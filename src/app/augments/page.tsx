import { getAugmentStats } from "@/lib/aggregate";
import { SampleSizeBadge, type StatsRow } from "@/components/StatsTable";
import { AugmentTabs } from "@/components/AugmentTabs";
import augmentsData from "@/lib/data/augments.json";

const augmentsById = new Map(augmentsData.map((a) => [a.id, a]));

export const dynamic = "force-dynamic";

export default async function AugmentsPage() {
  const { totalMatches, augments } = await getAugmentStats();

  const rowsByTier: Record<string, StatsRow[]> = { silver: [], gold: [], prismatic: [] };
  for (const entry of augments) {
    const info = augmentsById.get(entry.augmentId);
    const row: StatsRow = {
      key: String(entry.augmentId),
      name: info?.name ?? `Augment ${entry.augmentId}`,
      iconUrl: info?.iconUrl,
      games: entry.games,
      winRate: entry.winRate,
      avgPlacement: entry.avgPlacement,
    };
    const tier = info?.tier ?? "gold";
    (rowsByTier[tier] ??= []).push(row);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Augment Tier List</h1>
      <p className="mt-2 text-zinc-400">
        Win rate and average placement per augment, split by rarity.
      </p>
      <div className="mt-4 mb-6">
        <SampleSizeBadge totalMatches={totalMatches} />
      </div>
      <AugmentTabs rowsByTier={rowsByTier} />
    </div>
  );
}
