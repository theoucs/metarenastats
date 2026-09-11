import { resolveComboPick } from "@/lib/gameData";
import type { StatsRow } from "@/components/StatsTable";
import type { ComboStat } from "@/lib/aggregate";

/** Turns one Combos entry into a StatsRow with a "name + secondaryName" pair
 * — shared by the site-wide Combos page and each champion's mini combo tables. */
export function comboToRow(combo: ComboStat): StatsRow {
  const a = resolveComboPick(combo.a);
  const b = resolveComboPick(combo.b);
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
}
