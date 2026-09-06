import { NextRequest, NextResponse } from "next/server";

// Queue Arena actuelle depuis le patch 26.10 (mai 2026, format "Three by Six", 6 équipes de 3).
// 1700 est l'ancienne queue Arena 2v2, obsolète.
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
};

function riotHeaders() {
  return { "X-Riot-Token": process.env.RIOT_API_KEY ?? "" };
}

export async function GET(req: NextRequest) {
  const riotId = req.nextUrl.searchParams.get("riotId")?.trim() ?? "";
  const [gameName, tagLine] = riotId.split("#");

  if (!gameName || !tagLine) {
    return NextResponse.json(
      { error: "Format attendu : Pseudo#TAG (ex: Theoucs#EUW)" },
      { status: 400 }
    );
  }

  const accountRes = await fetch(
    `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    { headers: riotHeaders(), cache: "no-store" }
  );
  if (!accountRes.ok) {
    return NextResponse.json(
      { error: "Joueur introuvable sur EUW" },
      { status: accountRes.status === 404 ? 404 : 502 }
    );
  }
  const account: { puuid: string; gameName: string; tagLine: string } = await accountRes.json();

  const idsRes = await fetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=${ARENA_QUEUE_ID}&start=0&count=${MATCH_COUNT}`,
    { headers: riotHeaders(), cache: "no-store" }
  );
  if (!idsRes.ok) {
    return NextResponse.json({ error: "Erreur Riot API" }, { status: 502 });
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
          isSearchedPlayer: p.puuid === account.puuid,
        }));

      return {
        matchId,
        gameCreation: data.info.gameCreation,
        placement: me.placement,
        team,
      };
    })
  );

  return NextResponse.json({ account, matches });
}
