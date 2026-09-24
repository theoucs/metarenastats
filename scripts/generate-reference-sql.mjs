/**
 * Génère le SQL des données de référence à partir des JSON de src/lib/data.
 *
 * ─── POURQUOI GÉNÉRER PLUTÔT QU'ÉCRIRE ──────────────────────────────────────
 *
 * Les catégories d'items, les raretés d'augments et les rôles de champions
 * vivent dans src/lib/data/*.json, eux-mêmes produits par fetch-game-data.mjs
 * depuis Data Dragon et Community Dragon. C'est LA source ; la recopier à la
 * main en SQL créerait une seconde vérité qui divergerait au premier patch.
 *
 * Les agrégations descendues en base en ont besoin : la tier list des objets
 * distingue bottes, prismatiques et exclus, celle des compositions groupe par
 * rôle, et les augments d'événement sortent de toutes les stats.
 *
 * À relancer après chaque `node scripts/fetch-game-data.mjs`, et à appliquer
 * comme une migration. Le fichier produit est idempotent : il remplace le
 * contenu des tables au lieu de l'ajouter.
 *
 *   node scripts/generate-reference-sql.mjs > supabase/migrations/reference-data.sql
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(here, "..", "src", "lib", "data", name), "utf8"));

/**
 * Les items qui se transforment, LUS DANS gameData.ts plutôt que recopiés.
 *
 * Cette table n'est pas dans le JSON de Data Dragon : c'est une décision
 * d'agrégation prise ici (voir le commentaire d'ITEM_EVOLUTION). La recopier
 * dans ce script créerait la divergence que tout le fichier cherche à éviter —
 * on l'extrait donc de sa définition, et le script échoue bruyamment si elle
 * change de forme.
 */
function readItemEvolution() {
  const src = readFileSync(join(here, "..", "src", "lib", "gameData.ts"), "utf8");
  const block = src.match(/const ITEM_EVOLUTION[^=]*=\s*\{([^}]*)\}/);
  if (!block) throw new Error("ITEM_EVOLUTION introuvable dans gameData.ts — forme changée ?");
  const base = new Map();
  for (const [, from, to] of block[1].matchAll(/(\d+)\s*:\s*(\d+)/g)) {
    base.set(Number(to), Number(from));
  }
  if (base.size === 0) throw new Error("ITEM_EVOLUTION vide — forme changée ?");
  return base;
}

const canonicalById = readItemEvolution();
const items = read("items.json");
const augments = read("augments.json");
const champions = read("champions.json");

/** Une chaîne SQL sûre : on double les apostrophes, rien d'autre ne passe. */
const q = (v) => (v === undefined || v === null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

const rows = (list, cols) =>
  list.map((x) => `  (${cols.map((c) => c(x)).join(", ")})`).join(",\n");

console.log(`-- ════════════════════════════════════════════════════════════════════════════
-- DONNÉES DE RÉFÉRENCE — FICHIER GÉNÉRÉ, NE PAS MODIFIER À LA MAIN
-- ════════════════════════════════════════════════════════════════════════════
--
-- Produit par scripts/generate-reference-sql.mjs depuis src/lib/data/*.json,
-- qui sont eux-mêmes produits par fetch-game-data.mjs depuis Data Dragon et
-- Community Dragon. Toute correction se fait là-bas, puis on régénère.
--
-- ${items.length} items, ${augments.length} augments, ${champions.length} champions.
--
-- Ces tables existent pour les agrégations descendues en base : la tier list
-- des objets distingue bottes / prismatiques / exclus, celle des compositions
-- groupe par rôle, et les augments d'événement sortent de toutes les stats.
-- Sans elles, chaque agrégation devrait remonter ses lignes en JavaScript pour
-- y appliquer une catégorie — c'est-à-dire exactement ce qu'on cherche à
-- éviter.

create table if not exists ref_items (
  id       integer primary key,
  name     text not null,
  -- 'boots' | 'prismatic' | 'excluded' | null. Un item sans catégorie est une
  -- légendaire ordinaire : c'est le cas le plus courant, d'où le null.
  category text,
  -- L'identité sous laquelle l'item est agrégé : sa forme de base pour les
  -- quelques items qui se transforment (Manamune → Muramana), lui-même sinon.
  canonical_id integer not null
);

create table if not exists ref_augments (
  id       integer primary key,
  name     text not null,
  -- 'silver' | 'gold' | 'prismatic'
  tier     text,
  -- 'excluded' pour les augments d'événements ponctuels, jamais dans le pool
  -- normal : ils ne sont pas un choix stratégique et faussent les stats.
  category text
);

create table if not exists ref_champions (
  id    text primary key,
  name  text not null,
  -- Le PREMIER rôle déclaré, celui que championRole() renvoie côté app.
  role  text
);

grant select on ref_items, ref_augments, ref_champions to service_role;

-- Remplacement complet plutôt qu'un upsert : un item retiré du jeu doit
-- disparaître de la table, pas y rester avec sa dernière catégorie connue.
truncate ref_items, ref_augments, ref_champions;

insert into ref_items (id, name, category, canonical_id) values
${rows(items, [(x) => x.id, (x) => q(x.name), (x) => q(x.category), (x) => canonicalById.get(x.id) ?? x.id])};

insert into ref_augments (id, name, tier, category) values
${rows(augments, [(x) => x.id, (x) => q(x.name), (x) => q(x.tier), (x) => q(x.category)])};

insert into ref_champions (id, name, role) values
${rows(champions, [(x) => q(x.id), (x) => q(x.name), (x) => q(x.roles?.[0])])};

analyze ref_items;
analyze ref_augments;
analyze ref_champions;`);
