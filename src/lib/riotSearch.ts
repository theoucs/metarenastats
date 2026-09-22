import { supabaseAdmin } from "@/lib/supabase";
import { riotFetch } from "@/lib/riotClient";
import type { MatchCardData } from "@/components/MatchCard";

// Current Arena queue since patch 26.10 (May 2026, "Three by Six" 3v3 format, 6 teams of 3).
// 1700 is the legacy 2v2 Arena queue, obsolete.
export const ARENA_QUEUE_ID = 1750;
const MATCH_COUNT = 30;
// Le cadencement des appels est géré par riotClient (fenêtres 20/s ET 100/2min,
// réessai sur 429). Il ne reste ici qu'un plafond de requêtes simultanées, pour
// ne pas ouvrir 30 sockets d'un coup — le limiteur, lui, s'occupe du rythme.
const CONCURRENCY = 5;

type RiotParticipant = {
  puuid: string;
  riotIdGameName: string;
  riotIdTagline: string;
  championName: string;
  playerSubteamId: number;
  placement: number;
  kills: number;
  deaths: number;
  assists: number;
  playerAugment1: number;
  playerAugment2: number;
  playerAugment3: number;
  playerAugment4: number;
  playerAugment5: number;
  playerAugment6: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
};

type ParticipantDetail = {
  puuid: string;
  riotId: string;
  champion: string;
  subteamId: number;
  placement: number;
  kills: number;
  deaths: number;
  assists: number;
  augments: number[];
  items: number[];
};

export type MatchResult = {
  matchId: string;
  gameCreation: number;
  /** Version du jeu au moment de la partie, telle que Riot la renvoie
   *  (« 16.18.817.5716 »). C'est la seule façon fiable de ranger un match dans
   *  un patch : la date d'ingestion ne dit rien de la date de jeu, et un joueur
   *  peut très bien ne faire que quelques parties par an. La base en dérive le
   *  patch court (« 16.18 ») dans une colonne générée. */
  gameVersion: string | null;
  // All 18 players in the match (6 teams of 3) — the Riot API returns them
  // all in one call, so we save everyone, not just the searched player's team.
  participants: ParticipantDetail[];
};

export type SearchPlayerResult =
  | {
      ok: true;
      account: { puuid: string; gameName: string; tagLine: string };
      matches: MatchCardData[];
    }
  | { ok: false; status: number; error: string };

export function apiKey() {
  return process.env.RIOT_API_KEY ?? "";
}

// A non-404 failure from Riot (expired/invalid key, rate limit, Riot-side
// outage) is not "player not found" — surfacing it as such is misleading and,
// on a dev key that expires every 24h, this is the failure mode we're most
// likely to actually hit. Give a distinct, honest message per case instead.
function riotErrorResult(status: number): SearchPlayerResult {
  if (status === 404) {
    return { ok: false, status: 404, error: "Player not found on EUW" };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      status: 502,
      error: "Search is temporarily unavailable (API key issue) — please try again shortly.",
    };
  }
  if (status === 429) {
    return {
      ok: false,
      status: 502,
      error: "Too many searches right now — please try again in a moment.",
    };
  }
  return {
    ok: false,
    status: 502,
    error: "Riot API is temporarily unavailable — please try again shortly.",
  };
}

function toParticipantDetail(p: RiotParticipant): ParticipantDetail {
  return {
    puuid: p.puuid,
    riotId: `${p.riotIdGameName}#${p.riotIdTagline}`,
    champion: p.championName,
    subteamId: p.playerSubteamId,
    placement: p.placement,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    augments: [
      p.playerAugment1,
      p.playerAugment2,
      p.playerAugment3,
      p.playerAugment4,
      p.playerAugment5,
      p.playerAugment6,
    ].filter((a) => a > 0),
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].filter((i) => i > 0),
  };
}

/**
 * Récupère le détail d'un match Arena et le met en forme.
 *
 * Partagée par la recherche joueur et le crawler : c'est le seul endroit qui
 * sait traduire la réponse de Riot en `MatchResult`, pour que les deux chemins
 * d'ingestion écrivent exactement la même chose.
 *
 * @param maxWaitMs combien de temps accepter d'attendre un créneau de débit.
 *   La recherche veut échouer vite (défaut), le crawler veut attendre.
 */
export async function fetchMatchDetail(
  matchId: string,
  maxWaitMs?: number
): Promise<MatchResult | null> {
  const res = await riotFetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}`,
    apiKey(),
    maxWaitMs === undefined ? undefined : { maxWaitMs }
  );
  if (!res.ok) {
    console.error(`[riot] match ${matchId} ignoré : HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  const raw: RiotParticipant[] = data.info.participants;
  return {
    matchId,
    gameCreation: data.info.gameCreation,
    gameVersion: typeof data.info.gameVersion === "string" ? data.info.gameVersion : null,
    participants: raw.map(toParticipantDetail),
  };
}

/**
 * Resolves a Riot ID, pulls its recent Arena match history from Riot's API,
 * persists every participant (not just the searched player) to Supabase, and
 * returns display-ready match data. Used by both the player page and the
 * /api/matches route so there's a single place this logic lives.
 */
/**
 * Le tag appliqué quand le joueur n'en donne pas.
 *
 * Riot attribue par défaut le tag de la région, et l'immense majorité des
 * joueurs ne le change jamais. Le site ne suit que EUW : exiger « #EUW » à
 * chaque recherche revenait donc à faire retaper la même chose à presque tout
 * le monde, et à renvoyer une erreur de format à qui l'oubliait.
 */
const DEFAULT_TAG = "EUW";

/**
 * Découpe un Riot ID saisi à la main en nom + tag.
 *
 * Rend `null` seulement si le nom est vide : un tag absent n'est pas une
 * erreur, c'est le cas courant. Un tag explicite l'emporte toujours — on ne
 * corrige jamais ce que le joueur a écrit.
 */
export function parseRiotId(raw: string): { gameName: string; tagLine: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Un nom ne peut pas contenir de « # » : tout ce qui suit le PREMIER est le
  // tag, et un « # » final sans rien derrière vaut un tag absent.
  const hash = trimmed.indexOf("#");
  const gameName = (hash === -1 ? trimmed : trimmed.slice(0, hash)).trim();
  const tagLine = (hash === -1 ? "" : trimmed.slice(hash + 1)).trim();
  if (!gameName) return null;
  return { gameName, tagLine: tagLine || DEFAULT_TAG };
}

/** Le Riot ID complet correspondant à une saisie, tag par défaut compris. */
export function normalizeRiotId(raw: string): string | null {
  const parsed = parseRiotId(raw);
  return parsed && `${parsed.gameName}#${parsed.tagLine}`;
}

export async function searchPlayerMatches(riotId: string): Promise<SearchPlayerResult> {
  const parsed = parseRiotId(riotId);
  if (!parsed) {
    return { ok: false, status: 400, error: "Enter a player name (e.g. Theoucs, or Theoucs#EUW)" };
  }
  const { gameName, tagLine } = parsed;

  const accountRes = await riotFetch(
    `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    apiKey()
  );
  if (!accountRes.ok) {
    return riotErrorResult(accountRes.status);
  }
  const account: { puuid: string; gameName: string; tagLine: string } = await accountRes.json();

  const idsRes = await riotFetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=${ARENA_QUEUE_ID}&start=0&count=${MATCH_COUNT}`,
    apiKey()
  );
  if (!idsRes.ok) {
    return riotErrorResult(idsRes.status);
  }
  const matchIds: string[] = await idsRes.json();

  const fetched: (MatchResult | null)[] = [];
  for (let i = 0; i < matchIds.length; i += CONCURRENCY) {
    fetched.push(
      ...(await Promise.all(
        matchIds.slice(i, i + CONCURRENCY).map((id) => fetchMatchDetail(id))
      ))
    );
  }
  const matches = fetched.filter(
    (m): m is MatchResult =>
      m !== null && m.participants.some((p) => p.puuid === account.puuid)
  );

  // Awaited (unlike the old fire-and-forget version) so that the player page's
  // subsequent "overall stats" / "top champions" queries see this match data.
  await persistMatches(matches).catch((err) => console.error("Supabase save error:", err));

  // Group every match's 18 participants into their 6 teams, sorted by
  // placement, so the UI can show the searched player's team by default and
  // expand to the full lobby on demand.
  const displayMatches: MatchCardData[] = matches.map((m) => {
    const me = m.participants.find((p) => p.puuid === account.puuid)!;

    const bySubteam = new Map<number, typeof m.participants>();
    for (const p of m.participants) {
      const arr = bySubteam.get(p.subteamId) ?? [];
      arr.push(p);
      bySubteam.set(p.subteamId, arr);
    }
    const teams = Array.from(bySubteam.entries())
      .map(([subteamId, players]) => ({
        subteamId,
        placement: players[0].placement,
        players: players.map((p) => ({ ...p, isSearchedPlayer: p.puuid === account.puuid })),
      }))
      .sort((a, b) => a.placement - b.placement);

    return {
      matchId: m.matchId,
      gameCreation: m.gameCreation,
      placement: me.placement,
      teams,
    };
  });

  return { ok: true, account, matches: displayMatches };
}

export type SummonerProfile = { profileIconId: number; summonerLevel: number };

/**
 * Icône d'invocateur et niveau du compte.
 *
 * Sur le host `euw1`, dont le compteur de débit est distinct de celui d'`europe`
 * (vérifié) : cet appel ne consomme donc rien du budget des recherches de
 * matchs. Volontairement tolérant à l'échec — c'est un ornement d'en-tête, il ne
 * doit jamais faire échouer une page joueur.
 */
export async function fetchSummonerProfile(puuid: string): Promise<SummonerProfile | null> {
  try {
    const res = await riotFetch(
      `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      apiKey()
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.profileIconId === "number"
      ? { profileIconId: data.profileIconId, summonerLevel: data.summonerLevel ?? 0 }
      : null;
  } catch (error) {
    console.error("[riot] icône d'invocateur indisponible :", error);
    return null;
  }
}

/**
 * Écrit des matchs et leurs participants, en quatre temps.
 *
 * L'ordre n'est pas un choix : les clés étrangères de `match_participants`
 * imposent que la ligne `matches` ET la ligne `players` existent d'abord. Le
 * risque, c'est qu'un échec après la première écriture laisse un match
 * enregistré *à vide* — 161 matchs sur 913 étaient dans cet état, hérités d'une
 * version « fire-and-forget » dont la promesse était tuée à l'envoi de la
 * réponse.
 *
 * D'où le dernier temps : `ingested_at` n'est posé qu'une fois les participants
 * écrits. Un match resté à NULL est incomplet par définition, et le crawler le
 * reprend au passage suivant. L'incomplétude devient visible et réparable au
 * lieu d'être silencieuse.
 *
 * Le temps n° 2 est né de la compression du 2026-09-22 : la participation porte
 * désormais un `player_id` entier au lieu d'un puuid de 79 octets, qu'il faut
 * donc résoudre à l'écriture. C'est le prix de 415 Mo rendus à la base — et il
 * se paie en deux requêtes par paquet de dix matchs, pas par ligne.
 */
export async function persistMatches(matches: MatchResult[]) {
  if (!supabaseAdmin || matches.length === 0) return;

  // 1. Les matchs. `ingested_at` n'est volontairement pas dans la charge utile :
  //    en cas de conflit PostgREST ne met à jour que les colonnes fournies, donc
  //    re-ingérer un match déjà complet ne réinitialise pas son marqueur.
  const { error: matchesError } = await supabaseAdmin.from("matches").upsert(
    matches.map((m) => ({
      match_id: m.matchId,
      game_creation: new Date(m.gameCreation).toISOString(),
      queue_id: ARENA_QUEUE_ID,
      game_version: m.gameVersion,
    })),
    { onConflict: "match_id" }
  );
  if (matchesError) throw matchesError;

  // 2. Les joueurs, pour obtenir leur identifiant entier.
  //
  //    `ignoreDuplicates` et non un upsert qui met à jour : un upsert réécrirait
  //    la ligne de CHAQUE joueur croisé, soit ~250 000 réécritures par jour sur
  //    une table de 245 000 lignes. Postgres ne modifie pas une ligne en place,
  //    il en écrit une nouvelle et marque l'ancienne morte — la table doublerait
  //    de volume entre deux passages de l'autovacuum, pour ne rien changer dans
  //    l'immense majorité des cas. On insère donc les absents, et on ne corrige
  //    que les pseudos qui ont réellement changé (temps 2c).
  const seen = new Map<string, string>();
  for (const m of matches) {
    for (const p of m.participants) seen.set(p.puuid, p.riotId);
  }
  const puuids = [...seen.keys()];

  // 2a. Créer les manquants.
  const { error: newPlayersError } = await supabaseAdmin
    .from("players")
    .upsert(
      puuids.map((puuid) => ({ puuid, riot_id: seen.get(puuid) })),
      { onConflict: "puuid", ignoreDuplicates: true }
    );
  if (newPlayersError) throw newPlayersError;

  // 2b. Relire les identifiants. Séparé de 2a parce qu'`ignoreDuplicates` ne
  //     rend que les lignes réellement insérées — pas celles qui existaient.
  const { data: playerRows, error: playersError } = await supabaseAdmin
    .from("players")
    .select("id, puuid, riot_id")
    .in("puuid", puuids);
  if (playersError) throw playersError;

  const idByPuuid = new Map<string, number>();
  const renamed: { puuid: string; riot_id: string }[] = [];
  for (const row of playerRows ?? []) {
    idByPuuid.set(row.puuid as string, row.id as number);
    const fresh = seen.get(row.puuid as string);
    if (fresh && fresh !== row.riot_id) renamed.push({ puuid: row.puuid as string, riot_id: fresh });
  }

  // Un joueur vu à l'instant mais absent de la relecture ne peut venir que
  // d'une écriture concurrente perdue. Échouer ici est bien meilleur que de
  // poser `ingested_at` sur un match amputé de ce joueur : le match reste
  // incomplet, donc réparable au passage suivant.
  const missing = puuids.filter((puuid) => !idByPuuid.has(puuid));
  if (missing.length > 0) {
    throw new Error(`${missing.length} joueur(s) sans identifiant après insertion — match laissé incomplet.`);
  }

  // 2c. Les pseudos qui ont changé. Presque toujours zéro ligne : un joueur
  //     change de nom une fois par an, pas une fois par partie. C'est ce qui
  //     remplace le bloc de rattrapage que `sync_player_counts()` faisait
  //     toutes les heures — l'information arrive maintenant à la source.
  if (renamed.length > 0) {
    const { error: renameError } = await supabaseAdmin
      .from("players")
      .upsert(renamed, { onConflict: "puuid" });
    if (renameError) throw renameError;
  }

  // 3. Les participants.
  const participantRows = matches.flatMap((m) =>
    m.participants.map((p) => ({
      match_id: m.matchId,
      player_id: idByPuuid.get(p.puuid),
      subteam_id: p.subteamId,
      placement: p.placement,
      champion: p.champion,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      augments: p.augments,
      items: p.items,
    }))
  );
  const { error: participantsError } = await supabaseAdmin
    .from("match_participants")
    .upsert(participantRows, { onConflict: "match_id,player_id" });
  if (participantsError) throw participantsError;

  // 4. Marquer complets — jamais atteint si l'étape 2 a échoué.
  const { error: markError } = await supabaseAdmin
    .from("matches")
    .update({ ingested_at: new Date().toISOString() })
    .in(
      "match_id",
      matches.map((m) => m.matchId)
    );
  if (markError) throw markError;
}

/** Best-effort lookup of a previously-seen player by their exact Riot ID, used
 * as a fallback when a live Riot API call fails (e.g. expired key) but we
 * already have this player's data from a past search.
 *
 * Interrogé sur `players`, et non sur `match_participants`.
 *
 * Les deux portent le pseudo, mais l'un a une ligne par JOUEUR et l'autre une
 * ligne par PARTICIPATION : 245 000 contre 1 290 000, et surtout 36 Mo contre
 * 413 Mo à parcourir, aucune des deux tables n'ayant d'index sur le pseudo.
 * Mesuré le 2026-09-22, clé Riot expirée — donc sur le chemin que TOUT visiteur
 * empruntait : 47 s pour la page d'un joueur via les participations, 4,6 s via
 * les joueurs. `players.riot_id` est par ailleurs le pseudo le plus récent
 * (sync_player_counts le réécrit), là où une participation porte celui du jour
 * de la partie.
 *
 * 4,6 s reste trop : c'est un parcours complet. Le vrai correctif est un index
 * sur `lower(riot_id)` — il attend que la base ait de la place (voir le disque
 * saturé du 2026-09-22).
 */
export async function findKnownPlayerByRiotId(
  riotId: string
): Promise<{ puuid: string; riotId: string } | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("players")
    .select("puuid, riot_id")
    .ilike("riot_id", riotId)
    .not("riot_id", "is", null)
    .limit(1);
  return data && data[0] ? { puuid: data[0].puuid, riotId: data[0].riot_id } : null;
}
