import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { loadChampionPage, ChampionShell, TabHeading } from "../championPage";
import { augmentRowsByRarity } from "../championSections";

export const revalidate = 1800;

// Même ordre que la tier list générale des augments : le plus rare d'abord.
const RARITY_TABS = [
  { key: "prismatic", label: "Prismatic" },
  { key: "gold", label: "Gold" },
  { key: "silver", label: "Silver" },
] as const;

export default async function ChampionAugmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ patch?: string }>;
}) {
  const data = await loadChampionPage(params, searchParams);
  const { detail, champInfo } = data;

  const rowsByTier = detail ? augmentRowsByRarity(detail.allAugments, detail.games) : {};
  const shown = Object.values(rowsByTier).reduce((n, rows) => n + rows.length, 0);

  return (
    <ChampionShell data={data} active="augments">
      {detail && (
        <>
          <TabHeading title="Augments">
            Every augment taken on {champInfo.name}, tiered on {champInfo.name}&apos;s games alone —
            not on how the augment performs across the roster.
          </TabHeading>
          <div className="mt-4">
            <TieredStatsTabs
              tabs={RARITY_TABS}
              rowsByTier={rowsByTier}
              display="grid"
              playRateLabel="% of games"
              filterPlaceholder="Search an augment"
            />
          </div>
          <p className="mt-4 text-micro text-muted">
            {shown} augments shown, out of {detail.games} games. Augments taken fewer than 5 times on
            this champion are left out: at that sample a placement average says nothing.
          </p>
        </>
      )}
    </ChampionShell>
  );
}
