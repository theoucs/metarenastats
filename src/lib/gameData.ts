import championsData from "@/lib/data/champions.json";
import itemsData from "@/lib/data/items.json";
import augmentsData from "@/lib/data/augments.json";

// Case-insensitive: Riot's match API returns "FiddleSticks" while Data Dragon's
// champion id is "Fiddlesticks" — same fix as the Champions tier list page.
const championsByIdLower = new Map(championsData.map((c) => [c.id.toLowerCase(), c]));
const itemsById = new Map(itemsData.map((i) => [i.id, i]));
const augmentsById = new Map(augmentsData.map((a) => [a.id, a]));

export function resolveChampion(name: string) {
  return championsByIdLower.get(name.toLowerCase());
}

export function resolveItem(id: number) {
  return itemsById.get(id);
}

export function resolveAugment(id: number) {
  return augmentsById.get(id);
}

// "boots"/"prismatic"/"excluded" tag a minority of items (see items.json) —
// everything else (undefined) is a normal shop-bought Legendary/Mythic item.
// "excluded" covers items that are never a real shop choice: quest-only
// rewards (e.g. Shardblade, only obtainable via a full anvil run or a
// specific quest augment) and universally auto-granted items (e.g. Arcane
// Sweeper, present in ~all games regardless of build).
export type ItemCategory = "boots" | "prismatic" | "excluded";

export function itemCategory(id: number): ItemCategory | undefined {
  return itemsById.get(id)?.category as ItemCategory | undefined;
}
