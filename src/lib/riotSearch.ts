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
    participants: raw.map(toParticipantDetail),
  };
}

/**
 * Resolves a Riot ID, pulls its recent Arena match history from Riot's API,
 * persists every participant (not just the searched player) to Supabase, and
 * returns display-ready match data. Used by both the player page and the
 * /api/matches route so there's a single place this logic lives.
 */
export async function searchPlayerMatches(riotId: string): Promise<SearchPlayerResult> {
  const [gameName, tagLine] = riotId.split("#");
  if (!gameName || !tagLine) {
    return { ok: false, status: 400, error: "Expected format: Name#TAG (e.g. Theoucs#EUW)" };
  }

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
 * Écrit des matchs et leurs participants, en trois temps.
 *
 * L'ordre n'est pas un choix : la clé étrangère de `match_participants` impose
 * que la ligne `matches` existe d'abord. Le risque, c'est qu'un échec après
 * cette première écriture laisse un match enregistré *à vide* — 161 matchs sur
 * 913 étaient dans cet état, hérités d'une version « fire-and-forget » dont la
 * promesse était tuée à l'envoi de la réponse.
 *
 * D'où le troisième temps : `ingested_at` n'est posé qu'une fois les
 * participants écrits. Un match resté à NULL est incomplet par définition, et
 * le crawler le reprend au passage suivant. L'incomplétude devient visible et
 * réparable au lieu d'être silencieuse.
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
    })),
    { onConflict: "match_id" }
  );
  if (matchesError) throw matchesError;

  // 2. Les participants.
  const participantRows = matches.flatMap((m) =>
    m.participants.map((p) => ({
      match_id: m.matchId,
      puuid: p.puuid,
      riot_id: p.riotId,
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
    .upsert(participantRows, { onConflict: "match_id,puuid" });
  if (participantsError) throw participantsError;

  // 3. Marquer complets — jamais atteint si l'étape 2 a échoué.
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
 * already have this player's data from a past search. */
export async function findKnownPlayerByRiotId(
  riotId: string
): Promise<{ puuid: string; riotId: string } | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("match_participants")
    .select("puuid, riot_id")
    .ilike("riot_id", riotId)
    .limit(1);
  return data && data[0] ? { puuid: data[0].puuid, riotId: data[0].riot_id } : null;
}
