import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { loadChampionPage, ChampionShell, TabHeading } from "../championPage";
import { itemRowsByRarity, ItemSlotBlock } from "../championSections";

export const revalidate = 1800;

const RARITY_TABS = [
  { key: "legendary", label: "Legendary" },
  { key: "prismatic", label: "Prismatic" },
] as const;

export default async function ChampionItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ patch?: string }>;
}) {
  const data = await loadChampionPage(params, searchParams);
  const { detail, champInfo } = data;

  const rowsByTier = detail ? itemRowsByRarity(detail.allItems, detail.games) : {};
  const shown = Object.values(rowsByTier).reduce((n, rows) => n + rows.length, 0);

  return (
    <ChampionShell data={data} active="items">
      {detail && (
        <>
          <TabHeading title="Item Build">
            What {champInfo.name} buys, in the order it gets bought. The big icon is the usual pick
            for that slot; the small ones are the alternatives.
          </TabHeading>
          {detail.itemBuild.length === 0 ? (
            <p className="mt-3 rounded-lg border border-subtle bg-raised/20 p-3 text-small text-muted">
              No item data yet.
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-4 sm:gap-6">
              {detail.itemBuild.map((slot) => (
                <ItemSlotBlock key={slot.slot} slot={slot} />
              ))}
            </div>
          )}

          {/* Pas d'extrait « Top Prismatic Items » ici, contrairement au résumé :
              la liste complète juste en dessous a un onglet Prismatic qui dit
              la même chose en mieux, trié et cherchable. */}
          <TabHeading title="All Items">
            Every item seen on {champInfo.name}. The columns are raw; the tier is corrected for when
            each item arrives, so a late pickup doesn&apos;t win by default.
          </TabHeading>
          <div className="mt-4">
            <TieredStatsTabs
              tabs={RARITY_TABS}
              rowsByTier={rowsByTier}
              display="grid"
              playRateLabel="% of games"
              filterPlaceholder="Search an item"
            />
          </div>
          <p className="mt-4 text-micro text-muted">
            {shown} items shown, out of {detail.games} games. Items seen fewer than 5 times on this
            champion are left out.
          </p>
        </>
      )}
    </ChampionShell>
  );
}
