import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Current Arena queue since patch 26.10 (May 2026, "Three by Six" 3v3 format, 6 teams of 3).
// 1700 is the legacy 2v2 Arena queue, obsolete.
const ARENA_QUEUE_ID = 1750;
const MATCH_COUNT = 30;
// Personal/dev Riot key allows ~20 req/s — fetch match details in small
// concurrent batches instead of all at once to avoid tripping the rate limit.
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 300;

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

type MatchResult = {
  matchId: string;
  gameCreation: number;
  // All 18 players in the match (6 teams of 3) — the Riot API returns them
  // all in one call, so we save everyone, not just the searched player's team.
  participants: ParticipantDetail[];
};

function riotHeaders() {
  return { "X-Riot-Token": process.env.RIOT_API_KEY ?? "" };
}

// A non-404 failure from Riot (expired/invalid key, rate limit, Riot-side
// outage) is not "player not found" — surfacing it as such is misleading and,
// on a dev key that expires every 24h, this is the failure mode we're most
// likely to actually hit. Give a distinct, honest message per case instead.
function riotErrorResponse(status: number) {
  if (status === 404) {
    return NextResponse.json({ error: "Player not found on EUW" }, { status: 404 });
  }
  if (status === 401 || status === 403) {
    return NextResponse.json(
      { error: "Search is temporarily unavailable (API key issue) — please try again shortly." },
      { status: 502 }
    );
  }
  if (status === 429) {
    return NextResponse.json(
      { error: "Too many searches right now — please try again in a moment." },
      { status: 502 }
    );
  }
  return NextResponse.json(
    { error: "Riot API is temporarily unavailable — please try again shortly." },
    { status: 502 }
  );
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

export async function GET(req: NextRequest) {
  const riotId = req.nextUrl.searchParams.get("riotId")?.trim() ?? "";
  const [gameName, tagLine] = riotId.split("#");

  if (!gameName || !tagLine) {
    return NextResponse.json(
      { error: "Expected format: Name#TAG (e.g. Theoucs#EUW)" },
      { status: 400 }
    );
  }

  const accountRes = await fetch(
    `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    { headers: riotHeaders(), cache: "no-store" }
  );
  if (!accountRes.ok) {
    return riotErrorResponse(accountRes.status);
  }
  const account: { puuid: string; gameName: string; tagLine: string } = await accountRes.json();

  const idsRes = await fetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=${ARENA_QUEUE_ID}&start=0&count=${MATCH_COUNT}`,
    { headers: riotHeaders(), cache: "no-store" }
  );
  if (!idsRes.ok) {
    return riotErrorResponse(idsRes.status);
  }
  const matchIds: string[] = await idsRes.json();

  async function fetchMatch(matchId: string): Promise<MatchResult | null> {
    const res = await fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}`, {
      headers: riotHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`Skipping ${matchId}: Riot API returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    const raw: RiotParticipant[] = data.info.participants;
    if (!raw.some((p) => p.puuid === account.puuid)) return null;

    return {
      matchId,
      gameCreation: data.info.gameCreation,
      participants: raw.map(toParticipantDetail),
    };
  }

  const fetched: (MatchResult | null)[] = [];
  for (let i = 0; i < matchIds.length; i += BATCH_SIZE) {
    const batch = matchIds.slice(i, i + BATCH_SIZE);
    fetched.push(...(await Promise.all(batch.map(fetchMatch))));
    if (i + BATCH_SIZE < matchIds.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  const matches = fetched.filter((m): m is MatchResult => m !== null);

  persistMatches(matches).catch((err) => console.error("Supabase save error:", err));

  // Group every match's 18 participants into their 6 teams, sorted by
  // placement, so the UI can show the searched player's team by default and
  // expand to the full lobby on demand.
  const displayMatches = matches.map((m) => {
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

  return NextResponse.json({ account, matches: displayMatches });
}

async function persistMatches(matches: MatchResult[]) {
  if (!supabaseAdmin) return; // Supabase not configured yet, silently skip

  const matchRows = matches.map((m) => ({
    match_id: m.matchId,
    game_creation: new Date(m.gameCreation).toISOString(),
    queue_id: ARENA_QUEUE_ID,
  }));
  const { error: matchesError } = await supabaseAdmin.from("matches").upsert(matchRows, {
    onConflict: "match_id",
  });
  if (matchesError) throw matchesError;

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
}
