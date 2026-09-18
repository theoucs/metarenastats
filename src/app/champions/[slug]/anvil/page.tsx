import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { StatsGrid } from "@/components/StatsGrid";
import { loadChampionPage, ChampionShell, TabHeading } from "../championPage";
import {
  AnvilStatRow,
  ShardbladeRateBlock,
  augmentRowsByRarity,
  itemRowsByRarity,
} from "../championSections";

export const revalidate = 1800;

const AUGMENT_TABS = [
  { key: "prismatic", label: "Prismatic" },
  { key: "gold", label: "Gold" },
  { key: "silver", label: "Silver" },
] as const;

export default async function ChampionAnvilPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ patch?: string }>;
}) {
  const data = await loadChampionPage(params, searchParams);
  const { detail, champInfo } = data;

  const anvilGames = detail?.anvilStat.games ?? 0;
  const itemRows = detail ? itemRowsByRarity(detail.anvilItems, anvilGames) : {};
  const augmentRows = detail ? augmentRowsByRarity(detail.anvilAugments, anvilGames) : {};

  return (
    <ChampionShell data={data} active="anvil">
      {detail && (
        <>
          <TabHeading title="Anvil Run">
            Games where {champInfo.name} bought nothing at all — every item came from an anvil or an
            augment. A different game, so it gets its own numbers.
          </TabHeading>

          {anvilGames === 0 ? (
            <p className="mt-4 rounded-lg border border-subtle bg-raised/20 p-4 text-small text-muted">
              No anvil runs tracked on {champInfo.name} this patch.
            </p>
          ) : (
            <>
              <div className="mt-4 max-w-md">
                <AnvilStatRow stat={detail.anvilStat} />
                <ShardbladeRateBlock rate={detail.anvilShardbladeRate} />
              </div>

              <TabHeading title="Prismatic Items">
                Ranked among anvil runs only — &quot;% of games&quot; is a share of the{" "}
                {anvilGames} anvil games, not of every game.
              </TabHeading>
              {/* La grille seule, sans barre d'onglets : une enclume ne donne
                  que des prismatiques, un onglet unique n'offrirait aucun choix. */}
              <div className="mt-4">
                <StatsGrid
                  rows={itemRows.prismatic ?? []}
                  playRateLabel="% of anvil games"
                  filterPlaceholder="Search an item"
                />
              </div>

              <TabHeading title="Augments">
                Which augments show up when {champInfo.name} goes for anvils.
              </TabHeading>
              <div className="mt-4">
                <TieredStatsTabs
                  tabs={AUGMENT_TABS}
                  rowsByTier={augmentRows}
                  display="grid"
                  playRateLabel="% of anvil games"
                  filterPlaceholder="Search an augment"
                />
              </div>

              <p className="mt-4 text-micro text-muted">
                Built on {anvilGames} anvil games. That is a small sample even for a much-played
                champion, so the threshold here is 3 rather than 5 — the tiers are indicative, not a
                verdict.
              </p>
            </>
          )}
        </>
      )}
    </ChampionShell>
  );
}
