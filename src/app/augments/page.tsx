import { getAugmentStats, getAugmentTimingStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { type StatsRow } from "@/components/StatsTable";
import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { PageHeader } from "@/components/PageHeader";
import { PatchSwitch } from "@/components/PatchSwitch";
import { getPatchContext } from "@/lib/patches";
import { ShowMoreNote } from "@/components/ShowMoreNote";
import { resolveAugment } from "@/lib/gameData";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

const TABS = [
  { key: "prismatic", label: "Prismatic" },
  { key: "gold", label: "Gold" },
  { key: "silver", label: "Silver" },
] as const;

function toRowsByTier(
  augments: Awaited<ReturnType<typeof getAugmentStats>>["augments"],
  timing: Awaited<ReturnType<typeof getAugmentTimingStats>>,
) {
  const timingById = new Map(
    timing.augments.map((entry) => [
      entry.augmentId,
      { swing: entry.swing, rates: entry.slots.map((s) => s.top3Rate) },
    ]),
  );

  const rowsByTier: Record<string, StatsRow[]> = { silver: [], gold: [], prismatic: [] };
  for (const entry of augments) {
    const info = resolveAugment(entry.augmentId);
    const tier = info?.tier ?? "gold";
    const row: StatsRow = {
      key: String(entry.augmentId),
      entity: { type: "augment", id: entry.augmentId },
      name: info?.name ?? `Augment ${entry.augmentId}`,
      iconUrl: info?.iconUrl,
      rarity: tier as StatsRow["rarity"],
      games: entry.games,
      top3Rate: entry.top3Rate,
      top1Rate: entry.top1Rate,
      avgPlacement: entry.avgPlacement,
      playRate: entry.playRate,
      timing: timingById.get(entry.augmentId),
    };
    (rowsByTier[tier] ??= []).push(row);
  }
  return rowsByTier;
}

export default async function AugmentsPage() {
  const patch = await getPatchContext();

  const views = Object.fromEntries(
    await Promise.all(
      patch.options.map(async (option) => {
        const [{ augments }, timing] = await Promise.all([
          readSnapshot("augments", getAugmentStats, option.patch),
          readSnapshot("augmentTiming", getAugmentTimingStats, option.patch),
        ]);
        return [
          option.patch,
          <TieredStatsTabs
            filterPlaceholder="Search an augment"
            key={option.patch}
            tabs={TABS}
            rowsByTier={toRowsByTier(augments, timing)}
            display="grid"
          />,
        ] as const;
      }),
    ),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <PatchSwitch context={patch} views={views}>
        <PageHeader eyebrow="Tier list" title="Augments">
          <ShowMoreNote label="What Better early / Better late measure">
            <p className="max-w-2xl text-small text-muted">
              Sort by <span className="text-secondary">Better early</span> or{" "}
              <span className="text-secondary">Better late</span> to see which augments change value
              depending on when you take them — the figure is the gap between an augment&apos;s % Top 3
              as a 1st pick and as a 3rd pick, with each slot measured against its own baseline so a
              late pick doesn&apos;t score well just for having survived. Needs 30 picks per slot.
            </p>
          </ShowMoreNote>
        </PageHeader>
      </PatchSwitch>
    </div>
  );
}
