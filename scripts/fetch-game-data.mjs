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
  .map((a) => ({
    id: a.id,
    name: a.nameTRA,
    tier: RARITY_TO_TIER[a.rarity] ?? "gold",
    iconUrl: `https://raw.communitydragon.org/latest/game/${a.augmentSmallIconPath
      .replace(/^\/lol-game-data\/assets\//i, "")
      .toLowerCase()}`,
  }));

await writeFile(new URL("champions.json", OUT_DIR), JSON.stringify(champions, null, 2));
await writeFile(new URL("items.json", OUT_DIR), JSON.stringify(items, null, 2));
await writeFile(new URL("augments.json", OUT_DIR), JSON.stringify(augments, null, 2));

console.log(`Saved ${champions.length} champions, ${items.length} items, ${augments.length} augments to ${path.relative(process.cwd(), new URL(".", OUT_DIR).pathname)}`);
