import { getComboStats, type ComboStat } from "@/lib/aggregate";
import { SampleSizeBadge, type StatsRow } from "@/components/StatsTable";
import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { resolveItem, resolveAugment, itemCategory } from "@/lib/gameData";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "item-item", label: "Item + Item" },
  { key: "augment-augment", label: "Augment + Augment" },
  { key: "item-augment", label: "Item + Augment" },
] as const;

function resolvePick(pick: ComboStat["a"]) {
  if (pick.type === "item") {
    const info = resolveItem(pick.id);
    const rarity = itemCategory(pick.id) === "prismatic" ? "prismatic" : undefined;
    return { name: info?.name ?? `Item ${pick.id}`, iconUrl: info?.iconUrl, rarity };
  }
  const info = resolveAugment(pick.id);
  return { name: info?.name ?? `Augment ${pick.id}`, iconUrl: info?.iconUrl, rarity: info?.tier };
}

export default async function CombosPage() {
  const { totalMatches, byCategory } = await getComboStats(itemCategory);

  const rowsByTier: Record<string, StatsRow[]> = {
    "item-item": [],
    "augment-augment": [],
    "item-augment": [],
  };
  for (const [category, combos] of Object.entries(byCategory)) {
    rowsByTier[category] = combos.map((combo) => {
      const a = resolvePick(combo.a);
      const b = resolvePick(combo.b);
      return {
        key: `${combo.a.type}-${combo.a.id}_${combo.b.type}-${combo.b.id}`,
        name: a.name,
        iconUrl: a.iconUrl,
        rarity: a.rarity as StatsRow["rarity"],
        secondaryName: b.name,
        secondaryIconUrl: b.iconUrl,
        secondaryRarity: b.rarity as StatsRow["rarity"],
        games: combo.games,
        top3Rate: combo.top3Rate,
        top1Rate: combo.top1Rate,
        avgPlacement: combo.avgPlacement,
        playRate: combo.playRate,
      };
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Combos Tier List</h1>
        <span className="rounded-full bg-gradient-to-r from-blue-500 to-violet-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
          New
        </span>
      </div>
      <p className="mt-2 text-zinc-400">
        Pairs of items/augments picked by the same player in the same game, ranked by tier — a
        good combo shows up often (at least 5 games tracked) and performs well when it does. Top
        200 per category.
      </p>
      <div className="mt-4 mb-6">
        <SampleSizeBadge totalMatches={totalMatches} />
      </div>
      <TieredStatsTabs tabs={TABS} rowsByTier={rowsByTier} />
    </div>
  );
}
