/**
 * Compare deux publications de snapshots, champ par champ, sans en nommer un seul.
 *
 * ─── POURQUOI CE SCRIPT EXISTE ──────────────────────────────────────────────
 *
 * Le 2026-09-25, en migrant l'agrégation vers SQL, j'ai validé une réécriture
 * avec une requête qui comparait `c->>'games'` et `c->'tierStat'` sur une liste
 * où ces champs n'existent pas. Les deux côtés rendaient NULL,
 * `NULL is not distinct from NULL` est vrai, et la comparaison a répondu
 * « zéro différence ». Elle ne comparait rien.
 *
 * La leçon n'est pas « faire attention » : c'est qu'une comparaison qui NOMME
 * des champs peut silencieusement n'en trouver aucun. Ce script parcourt donc
 * les deux documents en entier et compare les FEUILLES qu'il rencontre. Il ne
 * peut pas rater un champ, puisqu'il n'en attend aucun — et il refuse de
 * conclure s'il n'a rien comparé.
 *
 * ─── ET POURQUOI LA PHASE CLASSEMENT NE DOIT PAS TOURNER ENTRE LES DEUX ─────
 *
 * Même jour, autre erreur : j'appelais `?only=ratings` entre deux publications,
 * pour lire la révision déployée. Cette phase réécrit `player_ratings`, dont
 * dérive le palier de niveau de chaque participation, dont dépend la référence
 * de chaque case de jalon. Je mesurais l'effet de mon propre appel — et j'ai
 * failli abandonner une migration correcte sur ce fantôme.
 *
 * Ce script ne publie donc QUE `?only=snapshots`, et il commence par vérifier
 * que deux publications consécutives sont identiques. Si elles ne le sont pas,
 * l'environnement bouge et aucune comparaison ultérieure ne voudra rien dire.
 *
 * ─── USAGE ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/verify-publication.mjs capture avant.json
 *       Publie deux fois, exige que les deux soient identiques, puis écrit
 *       la référence. À lancer AVANT de déployer le changement.
 *
 *   node scripts/verify-publication.mjs compare avant.json
 *       Publie une fois et compare à la référence. À lancer APRÈS.
 *
 * Le moteur de crawl doit être à l'arrêt : sinon la vue matérialisée change
 * entre les deux mesures et tout écart devient illisible. Le script le vérifie.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Au-delà, ce n'est plus de l'arrondi. Un double porte ~15 chiffres
 *  significatifs ; sur des valeurs de l'ordre de l'unité, une somme réordonnée
 *  dérive autour de 1e-14. Le seuil laisse deux ordres de grandeur de marge. */
const TOLERANCE = 1e-12;

function env(name, fallback) {
  if (process.env[name]) return process.env[name];
  const file = readFileSync(join(root, ".env.local"), "utf8");
  const line = file.split("\n").find((l) => l.startsWith(`${name}=`));
  if (line) return line.slice(name.length + 1).trim().replace(/^"|"$/g, "");
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} absent de l'environnement et de .env.local`);
}

function engineRunning() {
  try {
    const out = execSync(
      "gh run list --workflow=engine.yml --status in_progress --json databaseId -q '.[].databaseId'",
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.trim().length > 0;
  } catch {
    // gh absent ou non authentifié : on ne peut pas vérifier, on le dit.
    return null;
  }
}

async function publish() {
  const site = env("SITE_URL", "https://metarenastats.tblabs.dev").replace(/\/$/, "");
  const res = await fetch(`${site}/api/cron/refresh-stats?only=snapshots`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("CRON_SECRET")}` },
  }).catch(() => null);
  if (!res || !res.ok) throw new Error(`Publication échouée (HTTP ${res?.status ?? "réseau"})`);
  const report = await res.json();
  if (!report.ok) throw new Error(`Publication en erreur : ${report.error}`);
  return report;
}

async function readSnapshots() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const rows = [];
  for (let from = 0; ; from += 100) {
    const res = await fetch(`${url}/rest/v1/stats_snapshots?select=key,payload&order=key`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${from + 99}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) throw new Error(`Lecture des snapshots impossible (HTTP ${res.status})`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 100) break;
  }
  return Object.fromEntries(rows.map((r) => [r.key, r.payload]));
}

/**
 * Parcourt deux valeurs en parallèle et rend les feuilles qui diffèrent.
 *
 * Ne nomme aucun champ : c'est la propriété qui fait tout l'intérêt de ce
 * script. `compared` compte les feuilles réellement mises face à face, et
 * l'appelant refuse de conclure si ce compte est nul.
 */
function diffLeaves(a, b, path, out, stats) {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    stats.compared += 1;
    if (typeof a === "number" && typeof b === "number") {
      const delta = Math.abs(a - b);
      if (delta > 0) {
        stats.maxDelta = Math.max(stats.maxDelta, delta);
        if (delta > TOLERANCE) out.push({ path, a, b, delta });
        else stats.rounding += 1;
      }
      return;
    }
    if (a !== b) out.push({ path, a, b, delta: null });
    return;
  }

  const keysA = Array.isArray(a) ? a.map((_, i) => i) : Object.keys(a);
  const keysB = Array.isArray(b) ? b.map((_, i) => i) : Object.keys(b);
  for (const k of new Set([...keysA, ...keysB])) {
    if (!(k in a) || !(k in b)) {
      out.push({ path: `${path}.${k}`, a: k in a ? "présent" : "absent", b: k in b ? "présent" : "absent", delta: null });
      continue;
    }
    diffLeaves(a[k], b[k], `${path}.${k}`, out, stats);
  }
}

export function compareAll(before, after) {
  const out = [];
  const stats = { compared: 0, rounding: 0, maxDelta: 0 };
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (!(key in before) || !(key in after)) {
      out.push({ path: key, a: key in before ? "présent" : "absent", b: key in after ? "présent" : "absent", delta: null });
      continue;
    }
    diffLeaves(before[key], after[key], key, out, stats);
  }
  return { differences: out, ...stats, snapshots: keys.size };
}

// ─── programme ───────────────────────────────────────────────────────────────
//
// Sous garde : le fichier est aussi importé par son test, qui ne veut que
// `compareAll` et surtout pas une publication en production.

if (process.argv[1] !== fileURLToPath(import.meta.url)) {
  // Importé, pas exécuté : on s'arrête là.
} else {
await main();
}

async function main() {
const [mode, file] = process.argv.slice(2);
if (!["capture", "compare"].includes(mode) || !file) {
  console.error("usage: node scripts/verify-publication.mjs capture|compare <fichier>");
  process.exit(2);
}

const running = engineRunning();
if (running === true) {
  console.error("✗ Le moteur de crawl tourne. La vue matérialisée changerait entre les deux");
  console.error("  mesures et tout écart deviendrait illisible. Annule-le d'abord :");
  console.error("    gh run list --workflow=engine.yml --status in_progress");
  process.exit(1);
}
if (running === null) {
  console.warn("⚠ Impossible de vérifier l'état du moteur (gh absent ?) — assure-toi qu'il est arrêté.");
}

if (mode === "capture") {
  console.log("· publication 1/2");
  const r1 = await publish();
  const s1 = await readSnapshots();
  console.log("· publication 2/2 (sans phase classement entre les deux)");
  const r2 = await publish();
  const s2 = await readSnapshots();

  if (r1.sourceParticipants !== r2.sourceParticipants) {
    console.error(`✗ L'échantillon a changé entre les deux publications : ${r1.sourceParticipants} puis ${r2.sourceParticipants}.`);
    process.exit(1);
  }

  const check = compareAll(s1, s2);
  if (check.compared === 0) {
    console.error("✗ Zéro feuille comparée — les snapshots sont vides ou la lecture a échoué.");
    process.exit(1);
  }
  if (check.differences.length > 0) {
    console.error(`✗ Deux publications consécutives diffèrent sur ${check.differences.length} feuille(s).`);
    console.error("  L'environnement n'est pas stable ; aucune comparaison ultérieure ne voudra rien dire.");
    for (const d of check.differences.slice(0, 5)) console.error(`    ${d.path}: ${d.a} → ${d.b}`);
    process.exit(1);
  }

  writeFileSync(join(root, file), JSON.stringify(s1));
  console.log(`✓ Harnais stable : ${check.snapshots} snapshots, ${check.compared} feuilles, identiques.`);
  console.log(`  Référence écrite dans ${file} (${r1.sourceParticipants} participations).`);
} else {
  const before = JSON.parse(readFileSync(join(root, file), "utf8"));
  console.log("· publication");
  await publish();
  const after = await readSnapshots();

  const res = compareAll(before, after);
  if (res.compared === 0) {
    console.error("✗ Zéro feuille comparée — la référence et la publication n'ont aucun champ en commun.");
    process.exit(1);
  }

  console.log(`  ${res.snapshots} snapshots, ${res.compared} feuilles comparées.`);
  console.log(`  ${res.rounding} écart(s) d'arrondi sous ${TOLERANCE}, écart numérique maximal ${res.maxDelta.toExponential(2)}.`);

  if (res.differences.length === 0) {
    console.log("✓ Aucune différence réelle.");
    process.exit(0);
  }
  console.error(`✗ ${res.differences.length} différence(s) au-delà de la tolérance :`);
  for (const d of res.differences.slice(0, 20)) {
    console.error(`    ${d.path}: ${d.a} → ${d.b}${d.delta !== null ? ` (Δ ${d.delta.toExponential(2)})` : ""}`);
  }
  if (res.differences.length > 20) console.error(`    … et ${res.differences.length - 20} autres.`);
  process.exit(1);
}
}
