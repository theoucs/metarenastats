import Link from "next/link";
import { getComboStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { type StatsRow } from "@/components/StatsTable";
import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { PageHeader } from "@/components/PageHeader";
import { PatchSwitch } from "@/components/PatchSwitch";
import { getPatchContext } from "@/lib/patches";
import { itemCategory } from "@/lib/gameData";
import { comboToRow } from "@/lib/comboDisplay";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

const TABS = [
  { key: "item-item", label: "Item + Item" },
  { key: "augment-augment", label: "Augment + Augment" },
  { key: "item-augment", label: "Item + Augment" },
] as const;

export default async function CombosPage() {
  const patch = await getPatchContext();

  const views = Object.fromEntries(
    await Promise.all(
      patch.options.map(async (option) => {
        const { byCategory } = await readSnapshot(
          "combos",
          () => getComboStats(itemCategory),
          option.patch,
        );
        const rowsByTier: Record<string, StatsRow[]> = {
          "item-item": [],
          "augment-augment": [],
          "item-augment": [],
        };
        for (const [category, combos] of Object.entries(byCategory)) {
          rowsByTier[category] = combos.map(comboToRow);
        }
        return [
          option.patch,
          <TieredStatsTabs filterPlaceholder="Search an item or augment" key={option.patch} tabs={TABS} rowsByTier={rowsByTier} />,
        ] as const;
      }),
    ),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <PatchSwitch context={patch} views={views}>
        <PageHeader
          eyebrow="Tier list"
          title="Combos"
          isNew
          description="Two items or augments taken by the same player in the same game. Needs 5 games; top 200 per category."
        >
          <p className="mt-2 text-small text-muted">
            For combos on one champion, see{" "}
            <Link href="/champions" className="text-accent hover:underline">
              its champion page
            </Link>
            .
          </p>
        </PageHeader>
      </PatchSwitch>
    </div>
  );
}
