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

/** The six Data Dragon champion classes, in the order the Team Comps page lists them. */
export const CHAMPION_ROLES = [
  "Assassin",
  "Fighter",
  "Mage",
  "Marksman",
  "Support",
  "Tank",
] as const;
export type ChampionRole = (typeof CHAMPION_ROLES)[number];

/**
 * A champion's single defining class, for the Team Comps archetype tier list.
 *
 * Data Dragon gives 1-2 tags, most-defining first (Ahri = Mage, Assassin), and
 * every one of the 173 champions has at least one. Only the first is used:
 * bucketing by the full tag set would fragment 3.9k teams across far more
 * archetypes than the sample can support, which is the whole problem this page
 * exists to avoid.
 */
export function championRole(name: string): ChampionRole | undefined {
  return resolveChampion(name)?.roles?.[0] as ChampionRole | undefined;
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

/** Resolves one half of a Combos pair (see lib/aggregate.ts's ComboPick) to
 * display info, regardless of whether it's an item or an augment. */
export function resolveComboPick(pick: { type: "item" | "augment"; id: number }) {
  if (pick.type === "item") {
    const info = resolveItem(pick.id);
    const rarity = itemCategory(pick.id) === "prismatic" ? "prismatic" : undefined;
    return { name: info?.name ?? `Item ${pick.id}`, iconUrl: info?.iconUrl, rarity };
  }
  const info = resolveAugment(pick.id);
  return { name: info?.name ?? `Augment ${pick.id}`, iconUrl: info?.iconUrl, rarity: info?.tier };
}
