import Link from "next/link";
import { getComboStats } from "@/lib/aggregate";
import { SampleSizeBadge, type StatsRow } from "@/components/StatsTable";
import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { itemCategory } from "@/lib/gameData";
import { comboToRow } from "@/lib/comboDisplay";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "item-item", label: "Item + Item" },
  { key: "augment-augment", label: "Augment + Augment" },
  { key: "item-augment", label: "Item + Augment" },
] as const;

export default async function CombosPage() {
  const { totalMatches, byCategory } = await getComboStats(itemCategory);

  const rowsByTier: Record<string, StatsRow[]> = {
    "item-item": [],
    "augment-augment": [],
    "item-augment": [],
  };
  for (const [category, combos] of Object.entries(byCategory)) {
    rowsByTier[category] = combos.map(comboToRow);
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
        Pairs of items/augments picked by the same player in the same game — a good combo shows up
        often (at least 5 games tracked) and performs well when it does. Top 200 per category.
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        Looking for combos on a specific champion?{" "}
        <Link href="/champions" className="text-blue-400 hover:underline">
          Head to its champion page
        </Link>
        .
      </p>
      <div className="mt-4 mb-6">
        <SampleSizeBadge totalMatches={totalMatches} />
      </div>
      <TieredStatsTabs tabs={TABS} rowsByTier={rowsByTier} />
    </div>
  );
}
