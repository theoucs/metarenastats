// Trouve la date de bascule entre patchs, puis range les matchs antérieurs.
//
//   npm run patches          → cherche les frontières et met à jour la base
//   npm run patches -- --dry → cherche seulement, n'écrit pas patch_deduced
//
// ─── POURQUOI UNE DICHOTOMIE ─────────────────────────────────────────────────
//
// Riot écrit `gameVersion` dans chaque match, mais on ne l'a stockée qu'à partir
// du 2026-09-14 : 2 077 matchs antérieurs n'ont pas la leur. Les redemander
// coûterait 2 077 appels, soit des heures de budget pris au crawler.
//
// Or on n'a pas besoin du patch de chaque match : il suffit de savoir à quelle
// MINUTE chaque patch a commencé, puisque le patch d'une partie se déduit
// ensuite de sa date. Et cette minute se trouve par recherche dichotomique —
// le patch croît avec le temps, donc l'ordre est monotone.
//
//   2 077 matchs → log2(2077) ≈ 11 sondes par frontière
//
// Une vingtaine d'appels au lieu de 2 077, et aucun n'est gaspillé : chaque
// sonde écrit la vraie `game_version` du match qu'elle a interrogé.

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry");

/** Combien de patchs on veut pouvoir distinguer. Le site n'affiche que le patch
 *  courant et le précédent, donc deux frontières suffisent : le début de chacun.
 *  Tout ce qui précède est « plus ancien », sans besoin d'étiquette. */
const PATCHES_TO_LOCATE = 2;

/** En dessous de cet écart entre deux matchs encadrant la bascule, on s'arrête :
 *  affiner davantage coûterait des appels pour ranger quelques parties isolées. */
const PRECISION_TARGET_MINUTES = 60;

async function loadEnv() {
  try {
    const raw = await readFile(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // En CI les variables sont déjà là.
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Le patch court d'une version brute : « 16.18.817.5716 » → « 16.18 ». */
function shortPatch(version) {
  const [major, minor] = version.split(".");
  return `${major}.${minor}`;
}

/** Compare deux patchs courts numériquement (« 16.9 » < « 16.18 »). */
function comparePatch(a, b) {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am - bm || an - bn;
}

export function createProbe({ supabase, apiKey, stats }) {
  const cache = new Map();

  /**
   * Le patch d'un match, depuis la base si on le connaît déjà, sinon depuis
   * Riot — et dans ce cas on garde la réponse : une sonde ne doit jamais être
   * payée deux fois, y compris entre deux exécutions du script.
   */
  return async function probe(match) {
    if (cache.has(match.match_id)) return cache.get(match.match_id);
    if (match.game_version) {
      const patch = shortPatch(match.game_version);
      cache.set(match.match_id, patch);
      return patch;
    }

    const res = await fetch(
      `https://europe.api.riotgames.com/lol/match/v5/matches/${match.match_id}`,
      { headers: { "X-Riot-Token": apiKey } },
    );
    stats.riotCalls++;
    if (!res.ok) {
      console.warn(`  ⚠ ${match.match_id} : HTTP ${res.status}, sonde ignorée`);
      cache.set(match.match_id, null);
      return null;
    }
    const version = (await res.json()).info?.gameVersion;
    if (typeof version !== "string") {
      cache.set(match.match_id, null);
      return null;
    }

    await supabase.from("matches").update({ game_version: version }).eq("match_id", match.match_id);
    const patch = shortPatch(version);
    cache.set(match.match_id, patch);
    console.log(`  sonde ${match.game_creation.slice(0, 16)} → ${patch}`);

    // Le crawler tourne peut-être en même temps sur la même clé : on reste
    // discret plutôt que de lui prendre son budget.
    await sleep(1500);
    return patch;
  };
}

/**
 * Index du premier match dont le patch est >= `target`, par dichotomie.
 * `matches` doit être trié par date croissante.
 */
export async function findFirstIndexOfPatch(matches, target, probe) {
  let lo = 0;
  let hi = matches.length; // invariant : tout ce qui est >= hi est >= target
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const patch = await probe(matches[mid]);
    // Une sonde illisible ne doit pas bloquer : on la traite comme « avant »,
    // quitte à resserrer d'un cran de moins.
    if (patch !== null && comparePatch(patch, target) >= 0) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

async function main() {
  await loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.RIOT_API_KEY;
  if (!url || !key || !apiKey) {
    console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY et RIOT_API_KEY sont requis.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Tous les matchs, par date croissante. 2 000 lignes de trois colonnes : la
  // lecture est négligeable, et elle évite de sonder à l'aveugle.
  const matches = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("matches")
      .select("match_id, game_creation, game_version")
      .order("game_creation", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    matches.push(...data);
    if (data.length < 1000) break;
  }
  if (matches.length === 0) {
    console.log("Aucun match en base.");
    return;
  }
  console.log(`${matches.length} matchs, du ${matches[0].game_creation.slice(0, 10)} au ${matches.at(-1).game_creation.slice(0, 10)}\n`);

  const stats = { riotCalls: 0 };
  const probe = createProbe({ supabase, apiKey, stats });

  // Le patch le plus récent, lu sur le dernier match : c'est le patch courant.
  const latest = await probe(matches.at(-1));
  if (!latest) {
    console.error("Impossible de lire le patch du match le plus récent.");
    process.exit(1);
  }
  console.log(`patch courant : ${latest}\n`);

  // On remonte patch par patch. `16.18` puis `16.17` : un patch mineur qui
  // passe sous 1 signifie qu'on a changé de saison, cas qu'on ne cherche pas à
  // couvrir ici (le site n'affiche que deux patchs).
  const boundaries = [];
  let [major, minor] = latest.split(".").map(Number);
  for (let i = 0; i < PATCHES_TO_LOCATE && minor > 0; i++, minor--) {
    const target = `${major}.${minor}`;
    console.log(`── frontière de ${target} ──`);
    const index = await findFirstIndexOfPatch(matches, target, probe);
    if (index >= matches.length) {
      console.log(`  aucun match en ${target} ou plus récent\n`);
      continue;
    }
    const first = matches[index];
    const previous = index > 0 ? matches[index - 1] : null;
    const precision = previous
      ? Math.round(
          (new Date(first.game_creation) - new Date(previous.game_creation)) / 60000,
        )
      : null;
    boundaries.push({ patch: target, starts_at: first.game_creation, precision_minutes: precision });
    console.log(
      `  début ${target} : ${first.game_creation.slice(0, 16)}` +
        (precision === null
          ? " (aucun match avant, frontière non encadrée)"
          : ` (encadré à ${precision} min près)`) +
        "\n",
    );
    if (precision !== null && precision > PRECISION_TARGET_MINUTES) {
      console.log(
        `  ⚠ écart de ${precision} min entre les deux matchs qui encadrent la bascule :\n` +
          `    aucune partie n'a été jouée entre les deux, donc rien à mal ranger.\n`,
      );
    }
  }

  if (boundaries.length === 0) {
    console.log("Aucune frontière trouvée.");
    return;
  }

  if (DRY_RUN) {
    console.log(`\n[--dry] ${stats.riotCalls} appels Riot, rien n'a été écrit.`);
    return;
  }

  const { error: windowError } = await supabase
    .from("patch_windows")
    .upsert(boundaries.map((b) => ({ ...b, found_at: new Date().toISOString() })), {
      onConflict: "patch",
    });
  if (windowError) throw windowError;

  // Rangement des matchs sans version : chacun prend le patch dont la fenêtre
  // le contient. On part du plus récent pour que les bornes ne se chevauchent
  // pas — un match du 12/09 est en 16.18, pas en 16.17.
  const ordered = [...boundaries].sort((a, b) => comparePatch(b.patch, a.patch));
  let upperBound = null;
  let totalRanged = 0;
  for (const boundary of ordered) {
    // Compter AVANT de mettre à jour. Enchaîner `.select(..., { head: true })`
    // sur un `.update()` renvoie systématiquement 0 : la mise à jour a bien
    // lieu, mais le compte est perdu — le script annonçait « 0 match rangé »
    // alors qu'il en rangeait 1 461.
    const range = (q) => {
      let out = q.is("game_version", null).gte("game_creation", boundary.starts_at);
      return upperBound ? out.lt("game_creation", upperBound) : out;
    };

    const { count, error: countError } = await range(
      supabase.from("matches").select("match_id", { count: "exact", head: true }),
    );
    if (countError) throw countError;

    const { error } = await range(
      supabase.from("matches").update({ patch_deduced: boundary.patch }),
    );
    if (error) throw error;

    console.log(`${boundary.patch} : ${count ?? 0} matchs rangés par déduction`);
    totalRanged += count ?? 0;
    upperBound = boundary.starts_at;
  }

  console.log(`\n${stats.riotCalls} appels Riot, ${totalRanged} matchs rangés.`);
}

// Permet d'importer les fonctions pures pour les tester sans lancer le script.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
