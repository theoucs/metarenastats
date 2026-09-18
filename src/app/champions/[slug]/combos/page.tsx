import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { type StatsRow } from "@/components/StatsTable";
import { unpackCombo } from "@/lib/aggregate";
import { comboToRow } from "@/lib/comboDisplay";
import { loadChampionPage, ChampionShell, TabHeading } from "../championPage";

export const revalidate = 1800;

const COMBO_TABS = [
  { key: "item-item", label: "Item + Item" },
  { key: "item-augment", label: "Item + Augment" },
  { key: "augment-augment", label: "Augment + Augment" },
] as const;

export default async function ChampionCombosPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ patch?: string }>;
}) {
  const data = await loadChampionPage(params, searchParams);
  const { detail, champInfo } = data;

  const rowsByTier: Record<string, StatsRow[]> = {
    "item-item": [],
    "item-augment": [],
    "augment-augment": [],
  };
  let shown = 0;
  if (detail) {
    for (const [category, combos] of Object.entries(detail.allCombos)) {
      rowsByTier[category] = combos.map((c) => comboToRow(unpackCombo(c, detail.games)));
      shown += combos.length;
    }
  }

  return (
    <ChampionShell data={data} active="combos">
      {detail && (
        <>
          <TabHeading title="Combos">
            Pairs of picks held at the same time on {champInfo.name}. A pair is not a plan: two picks
            end up together partly because the game lasted long enough to collect both, so the games
            column deserves a look before the tier does.
          </TabHeading>
          <div className="mt-4">
            <TieredStatsTabs
              tabs={COMBO_TABS}
              rowsByTier={rowsByTier}
              defaultTab="item-augment"
              filterPlaceholder="Search an item or augment"
            />
          </div>
          <p className="mt-4 text-micro text-muted">
            {shown} pairs shown, out of {detail.games} games. This is the thinnest surface on the
            site, and its threshold is the highest because of it: a champion forms hundreds of pairs,
            and the more candidates you rank the more the best one stands out for reasons that
            aren&apos;t merit. Pairs seen fewer than 10 times are left out, and only the best 60 per
            category are kept. Unlike the Items tab, these numbers carry no correction for when a
            pick arrives — a pair completed late inherits the placement of a game that was already
            going well.
          </p>
        </>
      )}
    </ChampionShell>
  );
}
