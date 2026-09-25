/**
 * Vide les fonctions SQL de la base dans supabase/functions.sql.
 *
 * ─── POURQUOI VIDER PLUTÔT QUE TENIR À JOUR ─────────────────────────────────
 *
 * Les fonctions d'agrégation sont appliquées en migration : elles vivent dans
 * l'historique Supabase, qui est la vérité. Les recopier à la main dans le
 * dépôt créerait une deuxième version, qui divergerait à la première
 * correction — et personne ne s'en apercevrait avant d'essayer de reconstruire
 * la base à partir du dépôt.
 *
 * Un vidage ne peut pas diverger : il EST la base, à la date du vidage.
 *
 * À relancer après toute migration qui touche une fonction :
 *   node scripts/dump-sql-functions.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** Lit .env.local sans dépendance : trois lignes valent mieux qu'un paquet. */
function env(name) {
  if (process.env[name]) return process.env[name];
  const file = readFileSync(join(root, ".env.local"), "utf8");
  const line = file.split("\n").find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} absent de l'environnement et de .env.local`);
  return line.slice(name.length + 1).trim().replace(/^"|"$/g, "");
}

const url = env("SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");

const res = await fetch(`${url}/rest/v1/rpc/dump_aggregation_functions`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
if (!res.ok) {
  throw new Error(`Vidage impossible (HTTP ${res.status}) : ${await res.text()}`);
}

const defs = await res.json();
if (typeof defs !== "string" || defs.length < 100) {
  throw new Error("Vidage vide ou inattendu — la fonction dump_aggregation_functions existe-t-elle ?");
}

const entete = `-- ════════════════════════════════════════════════════════════════════════════
-- FONCTIONS SQL — FICHIER VIDÉ DEPUIS LA BASE, NE PAS MODIFIER À LA MAIN
-- ════════════════════════════════════════════════════════════════════════════
--
-- Produit par scripts/dump-sql-functions.mjs. La vérité est la base ; ce
-- fichier en est une photographie, prise pour que le dépôt puisse la
-- reconstruire et pour que les revues de code voient ce qui a changé.
--
-- Pour modifier une de ces fonctions : écrire une migration, l'appliquer, puis
-- relancer le script. Éditer ce fichier ne changerait rien à la base.
--
-- Vidé le ${new Date().toISOString().slice(0, 10)}.

`;

writeFileSync(join(root, "supabase", "functions.sql"), entete + defs + "\n");
const lignes = (entete + defs).split("\n").length;
console.log(`supabase/functions.sql écrit — ${lignes} lignes`);
