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

/**
 * Data Dragon skin numbers for the homepage hero background, keyed by
 * champion id. There's no usage data to pick a "most popular" skin from —
 * match_participants doesn't track which skin was worn — so this is a
 * hand-picked list of recognizable skins for champions likely to top the
 * tier list. Falls back to the base splash (skin 0) for anyone not listed;
 * add an entry here when a new champion takes the #1 spot.
 */
const HERO_SKIN_BY_CHAMPION: Record<string, number> = {
  Fiora: 4, // PROJECT: Fiora
  Yone: 1, // Spirit Blossom Yone
  Yasuo: 3, // Blood Moon Yasuo
  Katarina: 9, // PROJECT: Katarina
  Jinx: 4, // Star Guardian Jinx
  Kaisa: 14, // K/DA Kai'Sa
  Ahri: 15, // K/DA Ahri
  Darius: 4, // Dunkmaster Darius
  Sett: 8, // Obsidian Dragon Sett
  Volibear: 7, // Duality Dragon Volibear
  Ashe: 8, // PROJECT: Ashe
  Ezreal: 5, // Pulsefire Ezreal
  Vex: 10, // Empyrean Vex
  Ambessa: 8, // T1 Ambessa
  MissFortune: 16, // Gun Goddess Miss Fortune
};

/** Centered splash URL for a champion's hero-background skin (see above). */
export function heroSplashUrl(championKey: string): string {
  const skinNum = HERO_SKIN_BY_CHAMPION[championKey] ?? 0;
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/centered/${championKey}_${skinNum}.jpg`;
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
