import Link from "next/link";
import { getItemStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { type StatsRow } from "@/components/StatsTable";
import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { PageHeader } from "@/components/PageHeader";
import { PatchSwitch } from "@/components/PatchSwitch";
import { getPatchContext } from "@/lib/patches";
import { resolveItem, itemCategory } from "@/lib/gameData";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

const TABS = [
  { key: "legendary", label: "Legendary" },
  { key: "prismatic", label: "Prismatic" },
] as const;

function toRowsByTier(items: Awaited<ReturnType<typeof getItemStats>>["items"]) {
  const rowsByTier: Record<string, StatsRow[]> = { legendary: [], prismatic: [] };
  for (const entry of items) {
    const info = resolveItem(entry.itemId);
    // Boots and the plain shop pool (no category tag) both count as
    // "Legendary" here — only Prismatic items get their own tab.
    const isPrismatic = itemCategory(entry.itemId) === "prismatic";
    const row: StatsRow = {
      key: String(entry.itemId),
      entity: { type: "item", id: entry.itemId },
      name: info?.name ?? `Item ${entry.itemId}`,
      iconUrl: info?.iconUrl,
      rarity: isPrismatic ? "prismatic" : undefined,
      games: entry.games,
      top3Rate: entry.top3Rate,
      top1Rate: entry.top1Rate,
      avgPlacement: entry.avgPlacement,
      playRate: entry.playRate,
      // Les colonnes ci-dessus sont brutes ; c'est ce champ-là que le tier
      // consulte, corrigé du moment d'acquisition et du niveau des acheteurs.
      tierStat: entry.tierStat,
      timing: entry.timing,
    };
    rowsByTier[isPrismatic ? "prismatic" : "legendary"].push(row);
  }
  return rowsByTier;
}

export default async function ItemsPage() {
  const patch = await getPatchContext();

  const views = Object.fromEntries(
    await Promise.all(
      patch.options.map(async (option) => {
        const { items } = await readSnapshot(
          "items",
          () => getItemStats(itemCategory),
          option.patch,
        );
        return [
          option.patch,
          <TieredStatsTabs
            filterPlaceholder="Search an item"
            key={option.patch}
            tabs={TABS}
            rowsByTier={toRowsByTier(items)}
            display="grid"
          />,
        ] as const;
      }),
    ),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <PatchSwitch context={patch} views={views}>
        <PageHeader
          eyebrow="Tier list"
          title="Items"
          description={
            <>
              Adjusted for when each item arrives, so late pickups don&apos;t win by default (
              <Link href="/info#items" className="text-accent hover:underline">
                how tiers are calculated
              </Link>
              ).
            </>
          }
        />
      </PatchSwitch>
    </div>
  );
}
