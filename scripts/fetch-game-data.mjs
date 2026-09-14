// Fetches and caches reference data (champions, items, augments) as static JSON
// so pages don't hit Data Dragon / Community Dragon on every request.
// Re-run manually after a patch to refresh: node scripts/fetch-game-data.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = new URL("../src/lib/data/", import.meta.url);
// Les descriptions sont servies en statique, pas importées : voir plus bas.
const PUBLIC_DIR = new URL("../public/", import.meta.url);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} on ${url}`);
  return res.json();
}

// Some fields in these files are hand-curated, not fetched — items.json's
// `category` ("boots" / "prismatic" / "excluded") is maintained by hand and
// Data Dragon has no equivalent. Re-running this script used to silently wipe
// all 72 of them. Carry them across by id instead.
async function loadCurated(file, field) {
  try {
    const existing = JSON.parse(await readFile(new URL(file, OUT_DIR), "utf8"));
    return new Map(existing.filter((e) => e[field] !== undefined).map((e) => [e.id, e[field]]));
  } catch {
    return new Map(); // first run, or the file was deleted on purpose
  }
}

const versions = await fetchJson("https://ddragon.leagueoflegends.com/api/versions.json");
const ddragonVersion = versions[0];
console.log("Data Dragon version:", ddragonVersion);

// --- Champions ---
const championData = await fetchJson(
  `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/champion.json`
);
const champions = Object.values(championData.data).map((c) => ({
  id: c.id, // matches Riot's `championName` field, e.g. "Aatrox"
  name: c.name,
  iconUrl: `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${c.image.full}`,
  // Data Dragon lists 1-2 classes, most-defining first (Ahri = Mage, Assassin).
  // The Team Comps tier list buckets by the first one — see lib/gameData.ts.
  roles: c.tags,
}));

// --- Items ---
const itemData = await fetchJson(
  `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/item.json`
);
const curatedItemCategories = await loadCurated("items.json", "category");
const items = Object.entries(itemData.data)
  .filter(([, it]) => it.maps?.["30"]) // map 30 = Arena/Cherry
  .map(([id, it]) => {
    const category = curatedItemCategories.get(Number(id));
    return {
      id: Number(id),
      name: it.name,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${it.image.full}`,
      ...(category !== undefined ? { category } : {}),
    };
  });

// --- Augments (Community Dragon — not in official Data Dragon) ---
// cdragon/arena/en_us.json only had 225 legacy ("Cherry") augments and was
// missing most of the newer patch-26.10 ("Kiwi") ones — cherry-augments.json
// is the fuller, current source (657 entries, covers both).
const cherryAugments = await fetchJson(
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json"
);
const RARITY_TO_TIER = {
  kSilver: "silver",
  kGold: "gold",
  kPrismatic: "prismatic",
  kBronze: "silver", // lower tier, not part of normal rotation — closest bucket
  kEventChoice: "prismatic", // special event-only augments — closest bucket
};
// Les catégories d'augments sont curées à la main (voir `augmentCategory` dans
// gameData) et n'existent dans aucune source amont — il faut donc les relire
// avant d'écraser le fichier, exactement comme pour les items. Sans cette
// ligne, relancer ce script effaçait silencieusement les 11 augments marqués
// "excluded", qui revenaient alors polluer toutes les stats.
const curatedAugmentCategories = await loadCurated("augments.json", "category");

const augments = cherryAugments
  .filter((a) => a.nameTRA) // skip disabled/placeholder entries with no display name
  .filter((a) => {
    // The feed also bundles augments/blessings from other modes (Swarm =
    // "Strawberry" internally) that reuse low numeric IDs — e.g. id 1379
    // means "Upgrade Sword of Blossoming Dawn" in Swarm AND a real Arena
    // augment. Only keep entries whose icon path is actually Cherry (old
    // 2v2) or Kiwi (current 3v3) to avoid these silent ID collisions.
    const path = a.augmentSmallIconPath || "";
    return /\/(Cherry|Kiwi)\//i.test(path) && !/strawberry/i.test(path);
  })
  .map((a) => {
    const category = curatedAugmentCategories.get(a.id);
    return {
      id: a.id,
      name: a.nameTRA,
      tier: RARITY_TO_TIER[a.rarity] ?? "gold",
      iconUrl: `https://raw.communitydragon.org/latest/game/${a.augmentSmallIconPath
        .replace(/^\/lol-game-data\/assets\//i, "")
        .toLowerCase()}`,
      ...(category !== undefined ? { category } : {}),
    };
  });


// --- Descriptions (pour les infobulles au survol) ---------------------------
//
// Servies depuis `public/`, pas depuis `src/lib/data/` : trois composants
// client (MatchCard, StatsGrid, StatsTable) importent gameData, si bien que
// tout ce qu'on y ajoute part dans le bundle de CHAQUE page. Les descriptions
// pèsent plus que le reste des données réunies et ne servent qu'au survol —
// elles sont donc chargées à la demande, une seule fois, puis mises en cache
// par le navigateur.

/** Convertit le pseudo-HTML de Riot en texte lisible. */
function toPlainText(html) {
  if (!html) return "";
  return (
    html
      // Les sauts de ligne portent du sens (une ligne par effet) — les garder.
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(li|p|div|rules|mainText)>/gi, "\n")
      .replace(/<li>/gi, "• ")
      // Tout le reste du balisage est purement décoratif ici.
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      // Marqueurs d'icônes du client de jeu (%i:cooldown%) : sans les images
      // correspondantes, ce sont des jetons illisibles.
      .replace(/%i:[a-z0-9_]+%/gi, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Remplace les @Variables@ des descriptions d'augments par leur valeur.
 *
 * `dataValues` donne un tableau par variable (une entrée par niveau d'augment) ;
 * la première valeur est celle du niveau de base. La forme `@Nom*100@` sert à
 * afficher un ratio en pourcentage.
 */
function resolvePlaceholders(text, dataValues) {
  if (!text) return "";
  const lookup = new Map(Object.entries(dataValues ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return text.replace(/@([A-Za-z0-9_]+)(?:\*([0-9.]+))?@/g, (whole, name, mult) => {
    const values = lookup.get(name.toLowerCase());
    if (!Array.isArray(values) || values.length === 0) return whole;
    const value = values[0] * (mult ? Number(mult) : 1);
    // Les valeurs viennent en flottants ("0.009999999776482582") — arrondir,
    // sinon la description affiche une bouillie de décimales.
    return String(Math.round(value * 100) / 100);
  });
}

// Les augments non résolus gardent leur @Variable@ : plutôt que de l'afficher,
// on coupe la description à cet endroit — une phrase tronquée est moins
// déroutante qu'un jeton technique au milieu du texte.
function dropUnresolved(text) {
  return text
    .split("\n")
    .filter((line) => !/@[^@]+@/.test(line))
    .join("\n")
    .trim();
}

const arenaFeed = await fetchJson("https://raw.communitydragon.org/latest/cdragon/arena/en_us.json");
const augmentDescById = new Map(
  (arenaFeed.augments ?? []).map((a) => [
    a.id,
    dropUnresolved(toPlainText(resolvePlaceholders(a.desc, a.dataValues))),
  ])
);

// Écarte ce qui n'apprend rien : entrées vides, placeholders internes ("Null"),
// et textes trop courts pour valoir une infobulle.
function isUsefulDescription(text) {
  return text.length >= 12 && text.toLowerCase() !== "null";
}

const descriptions = { items: {}, augments: {} };
for (const item of items) {
  const raw = itemData.data[String(item.id)];
  // `description` porte les stats chiffrées ; `plaintext` n'est qu'un résumé
  // d'une ligne, gardé en repli quand la première est vide.
  const text = toPlainText(raw?.description) || toPlainText(raw?.plaintext);
  if (isUsefulDescription(text)) descriptions.items[item.id] = text;
}
for (const augment of augments) {
  const text = augmentDescById.get(augment.id) ?? "";
  if (isUsefulDescription(text)) descriptions.augments[augment.id] = text;
}

await writeFile(
  new URL("entity-descriptions.json", PUBLIC_DIR),
  JSON.stringify(descriptions)
);

await writeFile(new URL("champions.json", OUT_DIR), JSON.stringify(champions, null, 2));
await writeFile(new URL("items.json", OUT_DIR), JSON.stringify(items, null, 2));
await writeFile(new URL("augments.json", OUT_DIR), JSON.stringify(augments, null, 2));

console.log(`Saved ${champions.length} champions, ${items.length} items, ${augments.length} augments to ${path.relative(process.cwd(), new URL(".", OUT_DIR).pathname)}`);
console.log(
  `Descriptions: ${Object.keys(descriptions.items).length} items, ` +
    `${Object.keys(descriptions.augments).length} augments -> public/entity-descriptions.json`
);
