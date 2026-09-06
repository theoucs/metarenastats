import champions from "@/lib/data/champions.json";
import items from "@/lib/data/items.json";
import augments from "@/lib/data/augments.json";

export type SearchEntity = {
  type: "champion" | "item" | "augment";
  id: string; // matches the StatsTable row `key` on the destination page
  name: string;
  iconUrl: string;
  href: string;
};

export const SEARCH_INDEX: SearchEntity[] = [
  ...champions.map((c) => ({
    type: "champion" as const,
    id: c.id,
    name: c.name,
    iconUrl: c.iconUrl,
    href: `/champions#entity-${c.id}`,
  })),
  ...items.map((i) => ({
    type: "item" as const,
    id: String(i.id),
    name: i.name,
    iconUrl: i.iconUrl,
    href: `/items#entity-${i.id}`,
  })),
  ...augments.map((a) => ({
    type: "augment" as const,
    id: String(a.id),
    name: a.name,
    iconUrl: a.iconUrl,
    href: `/augments#entity-${a.id}`,
  })),
];

export function searchEntities(query: string, limit = 8): SearchEntity[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SEARCH_INDEX.filter((e) => e.name.toLowerCase().includes(q)).slice(0, limit);
}
