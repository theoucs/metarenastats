// Fetches and caches reference data (champions, items, augments) as static JSON
// so pages don't hit Data Dragon / Community Dragon on every request.
// Re-run manually after a patch to refresh: node scripts/fetch-game-data.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = new URL("../src/lib/data/", import.meta.url);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} on ${url}`);
  return res.json();
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
}));

// --- Items ---
const itemData = await fetchJson(
  `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/item.json`
);
const items = Object.entries(itemData.data)
  .filter(([, it]) => it.maps?.["30"]) // map 30 = Arena/Cherry
  .map(([id, it]) => ({
    id: Number(id),
    name: it.name,
    iconUrl: `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${it.image.full}`,
  }));

// --- Augments (Community Dragon — not in official Data Dragon) ---
const arenaData = await fetchJson(
  "https://raw.communitydragon.org/latest/cdragon/arena/en_us.json"
);
const RARITY_TO_TIER = { 0: "silver", 1: "gold", 2: "prismatic", 4: "prismatic" };
const augments = arenaData.augments.map((a) => ({
  id: a.id,
  name: a.name,
  tier: RARITY_TO_TIER[a.rarity] ?? "gold",
  iconUrl: `https://raw.communitydragon.org/latest/game/${a.iconSmall.toLowerCase()}`,
}));

await writeFile(new URL("champions.json", OUT_DIR), JSON.stringify(champions, null, 2));
await writeFile(new URL("items.json", OUT_DIR), JSON.stringify(items, null, 2));
await writeFile(new URL("augments.json", OUT_DIR), JSON.stringify(augments, null, 2));

console.log(`Saved ${champions.length} champions, ${items.length} items, ${augments.length} augments to ${path.relative(process.cwd(), new URL(".", OUT_DIR).pathname)}`);
