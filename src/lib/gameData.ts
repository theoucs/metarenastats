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
