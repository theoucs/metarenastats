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
 * Data Dragon skin numbers keyed by champion id, used everywhere a champion's
 * splash art is shown (homepage hero, champion pages). There's no usage data
 * to pick a "most popular" skin from — match_participants doesn't track which
 * skin was worn — so this is a hand-picked list of each champion's most
 * recognizable/popular skin, covering the full roster so the pick stays
 * relevant no matter who's on top of the tier list this patch. Falls back to
 * the base splash (skin 0) for anyone not listed (e.g. a newly added
 * champion); re-check picks occasionally as new skins release.
 */
const POPULAR_SKIN_BY_CHAMPION: Record<string, number> = {
  Aatrox: 7, // Blood Moon Aatrox
  Ahri: 15, // K/DA Ahri
  Akali: 9, // K/DA Akali
  Akshan: 21, // High Noon Akshan
  Alistar: 3, // Matador Alistar
  Ambessa: 8, // T1 Ambessa
  Amumu: 7, // Sad Robot Amumu
  Anivia: 27, // Divine Phoenix Anivia
  Annie: 8, // Panda Annie
  Aphelios: 30, // HEARTSTEEL Aphelios
  Ashe: 8, // PROJECT: Ashe
  AurelionSol: 2, // Mecha Aurelion Sol
  Aurora: 1, // Battle Bunny Aurora
  Azir: 3, // SKT T1 Azir
  Bard: 8, // Astronaut Bard
  Belveth: 10, // Cosmic Matriarch Bel'Veth
  Blitzcrank: 5, // Definitely Not Blitzcrank
  Brand: 21, // Debonair Brand
  Braum: 1, // Dragonslayer Braum
  Briar: 20, // Battle Academia Briar
  Caitlyn: 19, // Arcade Caitlyn
  Camille: 1, // Program Camille
  Cassiopeia: 3, // Mythic Cassiopeia
  Chogath: 5, // Battlecast Prime Cho'Gath
  Corki: 3, // Red Baron Corki
  Darius: 4, // Dunkmaster Darius
  Diana: 18, // Dragonslayer Diana
  DrMundo: 9, // El Macho Mundo
  Draven: 6, // Draven Draven
  Ekko: 19, // True Damage Ekko
  Elise: 4, // SKT T1 Elise
  Evelynn: 6, // K/DA Evelynn
  Ezreal: 5, // Pulsefire Ezreal
  Fiddlesticks: 4, // Pumpkinhead Fiddlesticks
  Fiora: 4, // PROJECT: Fiora
  Fizz: 14, // Fuzz Fizz
  Galio: 5, // Debonair Galio
  Gangplank: 33, // PROJECT: Gangplank
  Garen: 13, // God-King Garen
  Gnar: 13, // Super Galaxy Gnar
  Gragas: 6, // Oktoberfest Gragas
  Graves: 4, // Riot Graves
  Gwen: 1, // Space Groove Gwen
  Hecarim: 8, // High Noon Hecarim
  Heimerdinger: 33, // Arcane Professor Heimerdinger
  Hwei: 11, // Spirit Blossom Hwei
  Illaoi: 27, // Battle Bear Illaoi
  Irelia: 16, // PROJECT: Irelia
  Ivern: 11, // Old God Ivern
  Janna: 7, // Star Guardian Janna
  JarvanIV: 2, // Dragonslayer Jarvan IV
  Jax: 33, // PROJECT: Jax
  Jayce: 24, // Arcane Inventor Jayce
  Jhin: 4, // PROJECT: Jhin
  Jinx: 4, // Star Guardian Jinx
  KSante: 8, // HEARTSTEEL K'Sante
  Kaisa: 14, // K/DA Kai'Sa
  Kalista: 3, // SKT T1 Kalista
  Karma: 1, // Sun Goddess Karma
  Karthus: 4, // Pentakill Karthus
  Kassadin: 5, // Cosmic Reaver Kassadin
  Katarina: 9, // PROJECT: Katarina
  Kayle: 9, // Pentakill Kayle
  Kayn: 8, // Nightbringer Kayn
  Kennen: 7, // Super Kennen
  Khazix: 1, // Mecha Kha'Zix
  Kindred: 3, // Spirit Blossom Kindred
  Kled: 2, // Count Kledula
  KogMaw: 28, // Bee'Maw
  Leblanc: 4, // Ravenborn LeBlanc
  LeeSin: 11, // God Fist Lee Sin
  Leona: 10, // Solar Eclipse Leona
  Lillia: 1, // Spirit Blossom Lillia
  Lissandra: 4, // Coven Lissandra
  Locke: 1, // High Noon Locke
  Lucian: 18, // Pulsefire Lucian
  Lulu: 6, // Star Guardian Lulu
  Lux: 7, // Elementalist Lux
  Malphite: 6, // Mecha Malphite
  Malzahar: 4, // Overlord Malzahar
  Maokai: 6, // Meowkai
  MasterYi: 9, // PROJECT: Yi
  Mel: 1, // Arcane Councilor Mel
  Milio: 1, // Faerie Court Milio
  MissFortune: 16, // Gun Goddess Miss Fortune
  MonkeyKing: 3, // Jade Dragon Wukong
  Mordekaiser: 3, // Pentakill Mordekaiser
  Morgana: 26, // Coven Morgana
  Naafiri: 11, // PROJECT: Naafiri
  Nami: 9, // Program Nami
  Nasus: 1, // Galactic Nasus
  Nautilus: 27, // Cosmic Paladin Nautilus
  Neeko: 10, // Star Guardian Neeko
  Nidalee: 9, // Super Galaxy Nidalee
  Nilah: 1, // Star Guardian Nilah
  Nocturne: 5, // Eternum Nocturne
  Nunu: 1, // Sasquatch Nunu & Willump
  Olaf: 4, // Pentakill Olaf
  Orianna: 29, // Star Guardian Orianna
  Ornn: 20, // Choo-Choo Ornn
  Pantheon: 16, // Pulsefire Pantheon
  Poppy: 7, // Star Guardian Poppy
  Pyke: 16, // PROJECT: Pyke
  Qiyana: 2, // True Damage Qiyana
  Quinn: 14, // Star Guardian Quinn
  Rakan: 5, // Star Guardian Rakan
  Rammus: 35, // Baron Rammus
  RekSai: 1, // Eternum Rek'Sai
  Rell: 10, // Star Guardian Rell
  Renata: 1, // Admiral Glasc
  Renekton: 26, // PROJECT: Renekton
  Rengar: 8, // Mecha Rengar
  Riven: 23, // Spirit Blossom Riven
  Rumble: 3, // Super Galaxy Rumble
  Ryze: 10, // SKT T1 Ryze
  Samira: 1, // PsyOps Samira
  Sejuani: 16, // PROJECT: Sejuani
  Senna: 1, // True Damage Senna
  Seraphine: 34, // Star Guardian Seraphine
  Sett: 8, // Obsidian Dragon Sett
  Shaco: 64, // Cat-in-the-Box Shaco
  Shen: 15, // Pulsefire Shen
  Shyvana: 6, // Super Galaxy Shyvana
  Singed: 9, // Beekeeper Singed
  Sion: 30, // High Noon Sion
  Sivir: 72, // PROJECT: Sivir
  Skarner: 3, // Battlecast Alpha Skarner
  Smolder: 1, // Heavenscale Smolder
  Sona: 6, // DJ Sona
  Soraka: 7, // Star Guardian Soraka
  Swain: 4, // Dragon Master Swain
  Sylas: 13, // PROJECT: Sylas
  Syndra: 6, // Star Guardian Syndra
  TahmKench: 39, // Choncc Kench
  Taliyah: 11, // Star Guardian Taliyah
  Talon: 38, // High Noon Talon
  Taric: 18, // Space Groove Taric
  Teemo: 14, // Little Devil Teemo
  Thresh: 13, // Pulsefire Thresh
  Tristana: 1, // Riot Girl Tristana
  Trundle: 6, // Dragonslayer Trundle
  Tryndamere: 18, // Nightbringer Tryndamere
  TwistedFate: 11, // Pulsefire Twisted Fate
  Twitch: 8, // Omega Squad Twitch
  Udyr: 3, // Spirit Guard Udyr
  Urgot: 1, // Giant Enemy Crabgot
  Varus: 16, // PROJECT: Varus
  Vayne: 11, // PROJECT: Vayne
  Veigar: 8, // Final Boss Veigar
  Velkoz: 20, // Bee'Koz
  Vex: 10, // Empyrean Vex
  Vi: 29, // Arcane Undercity Vi
  Viego: 10, // Dissonance of Pentakill Viego
  Viktor: 24, // Arcane Savior Viktor
  Vladimir: 21, // Cosmic Devourer Vladimir
  Volibear: 7, // Duality Dragon Volibear
  Warwick: 1, // Grey Warwick
  Xayah: 4, // Star Guardian Xayah
  Xerath: 4, // Guardian of the Sands Xerath
  XinZhao: 13, // Dragonslayer Xin Zhao
  Yasuo: 3, // Blood Moon Yasuo
  Yone: 1, // Spirit Blossom Yone
  Yorick: 2, // Pentakill Yorick
  Yunara: 1, // Spirit Blossom Springs Yunara
  Yuumi: 49, // Cyber Cat Yuumi
  Zaahen: 1, // Immortal Journey Zaahen
  Zac: 6, // SKT T1 Zac
  Zed: 3, // PROJECT: Zed
  Zeri: 19, // Immortal Journey Zeri
  Ziggs: 5, // Master Arcanist Ziggs
  Zilean: 1, // Old Saint Zilean
  Zoe: 9, // Star Guardian Zoe
  Zyra: 5, // Coven Zyra
};

/** Centered splash URL for a champion's most popular skin (see above). */
export function heroSplashUrl(championKey: string): string {
  const skinNum = POPULAR_SKIN_BY_CHAMPION[championKey] ?? 0;
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

/**
 * "excluded" augments are picks from one-off Arena events (the Predator/Prey
 * duo, the Risk/Wealth trio) that showed up in tracked matches but were never
 * part of the normal augment pool — never a real strategic choice, so they're
 * dropped from every augment-based stat (see fetchAllParticipants).
 */
export function augmentCategory(id: number): "excluded" | undefined {
  return augmentsById.get(id)?.category as "excluded" | undefined;
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
