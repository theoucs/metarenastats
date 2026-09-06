"use client";

import { useState } from "react";

type TeammateStats = {
  riotId: string;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  augments: number[];
  isSearchedPlayer: boolean;
};

type MatchResult = {
  matchId: string;
  gameCreation: number;
  placement: number;
  team: TeammateStats[];
};

type ApiResponse = {
  account?: { gameName: string; tagLine: string };
  matches?: MatchResult[];
  error?: string;
};

function placementColor(placement: number) {
  if (placement === 1) return "text-yellow-400";
  if (placement <= 3) return "text-emerald-400";
  return "text-zinc-400";
}

export default function Home() {
  const [riotId, setRiotId] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!riotId.includes("#")) return;
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`/api/matches?riotId=${encodeURIComponent(riotId)}`);
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">
          Meta<span className="text-blue-500">Arena</span>Stats
        </h1>
        <p className="mt-2 text-zinc-400">
          Historique de matchs Arena (EUW) — format 3v3 &quot;Three by Six&quot;.
        </p>

        <form onSubmit={handleSearch} className="mt-8 flex gap-2">
          <input
            value={riotId}
            onChange={(e) => setRiotId(e.target.value)}
            placeholder="Pseudo#TAG (ex: Theoucs#EUW)"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-5 py-2 font-medium transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Recherche..." : "Chercher"}
          </button>
        </form>

        {data?.error && (
          <p className="mt-6 rounded-lg bg-red-950/50 px-4 py-3 text-red-300">{data.error}</p>
        )}

        {data?.matches && (
          <div className="mt-8 flex flex-col gap-3">
            {data.matches.length === 0 && (
              <p className="text-zinc-400">Aucune partie Arena récente trouvée.</p>
            )}
            {data.matches.map((match) => {
              const me = match.team.find((p) => p.isSearchedPlayer);
              return (
                <div
                  key={match.matchId}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xl font-bold ${placementColor(match.placement)}`}>
                      #{match.placement}
                    </span>
                    <span className="text-sm text-zinc-500">
                      {new Date(match.gameCreation).toLocaleString("fr-FR")}
                    </span>
                  </div>
                  {me && (
                    <p className="mt-1 text-zinc-300">
                      <span className="font-medium text-zinc-100">{me.champion}</span> —{" "}
                      {me.kills}/{me.deaths}/{me.assists}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-sm text-zinc-500">
                    {match.team
                      .filter((p) => !p.isSearchedPlayer)
                      .map((p) => (
                        <span key={p.riotId} className="rounded bg-zinc-800 px-2 py-0.5">
                          {p.champion} ({p.riotId})
                        </span>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
