import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Current Arena queue since patch 26.10 (May 2026, "Three by Six" 3v3 format, 6 teams of 3).
// 1700 is the legacy 2v2 Arena queue, obsolete.
const ARENA_QUEUE_ID = 1750;
const MATCH_COUNT = 10;

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

type MatchResult = {
  matchId: string;
  gameCreation: number;
  subteamId: number;
  placement: number;
  team: {
    puuid: string;
    riotId: string;
    champion: string;
    kills: number;
    deaths: number;
    assists: number;
    augments: number[];
    items: number[];
    isSearchedPlayer: boolean;
  }[];
};

function riotHeaders() {
  return { "X-Riot-Token": process.env.RIOT_API_KEY ?? "" };
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
    return NextResponse.json(
      { error: "Player not found on EUW" },
      { status: accountRes.status === 404 ? 404 : 502 }
    );
  }
  const account: { puuid: string; gameName: string; tagLine: string } = await accountRes.json();

  const idsRes = await fetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=${ARENA_QUEUE_ID}&start=0&count=${MATCH_COUNT}`,
    { headers: riotHeaders(), cache: "no-store" }
  );
  if (!idsRes.ok) {
    return NextResponse.json({ error: "Riot API error" }, { status: 502 });
  }
  const matchIds: string[] = await idsRes.json();

  const matches = await Promise.all(
    matchIds.map(async (matchId) => {
      const res = await fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}`, {
        headers: riotHeaders(),
        cache: "no-store",
      });
      const data = await res.json();
      const participants: RiotParticipant[] = data.info.participants;
      const me = participants.find((p) => p.puuid === account.puuid)!;
      const team = participants
        .filter((p) => p.playerSubteamId === me.playerSubteamId)
        .map((p) => ({
          puuid: p.puuid,
          riotId: `${p.riotIdGameName}#${p.riotIdTagline}`,
          champion: p.championName,
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
          items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].filter(
            (i) => i > 0
          ),
          isSearchedPlayer: p.puuid === account.puuid,
        }));

      return {
        matchId,
        gameCreation: data.info.gameCreation,
        subteamId: me.playerSubteamId,
        placement: me.placement,
        team,
      };
    })
  );

  persistMatches(matches).catch((err) => console.error("Supabase save error:", err));

  return NextResponse.json({ account, matches });
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
    m.team.map((p) => ({
      match_id: m.matchId,
      puuid: p.puuid,
      riot_id: p.riotId,
      subteam_id: m.subteamId,
      placement: m.placement,
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
