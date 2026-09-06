"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { searchEntities } from "@/lib/searchIndex";

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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);

  const isPlayerQuery = query.includes("#");
  const suggestions = useMemo(
    () => (isPlayerQuery ? [] : searchEntities(query)),
    [query, isPlayerQuery]
  );

  async function searchPlayer(riotId: string) {
    if (!riotId.includes("#")) return;
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`/api/matches?riotId=${encodeURIComponent(riotId)}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
        Meta<span className="text-blue-500">Arena</span>Stats
      </h1>
      <p className="mt-4 max-w-xl text-balance text-zinc-400">
        Free stats, tier lists and leaderboards for League of Legends Arena — the 3v3 &quot;Three
        by Six&quot; mode.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          searchPlayer(query);
        }}
        className="relative mt-10 w-full max-w-xl"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a player (Name#TAG), champion, item or augment..."
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-3.5 text-base text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-blue-500"
        />

        {suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-left shadow-2xl">
            {suggestions.map((s) => (
              <li key={`${s.type}-${s.id}`}>
                <button
                  type="button"
                  onClick={() => router.push(s.href)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-zinc-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.iconUrl} alt="" className="h-7 w-7 rounded-md object-cover" />
                  <span className="text-zinc-100">{s.name}</span>
                  <span className="ml-auto text-xs uppercase tracking-wide text-zinc-500">
                    {s.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {isPlayerQuery && (
          <button
            type="submit"
            disabled={loading}
            className="mt-3 w-full rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search player"}
          </button>
        )}
      </form>

      {data?.error && (
        <p className="mt-6 w-full max-w-xl rounded-lg bg-red-950/50 px-4 py-3 text-red-300">
          {data.error}
        </p>
      )}

      {data?.matches && (
        <div className="mt-8 flex w-full max-w-xl flex-col gap-3 text-left">
          {data.matches.length === 0 && (
            <p className="text-zinc-400">No recent Arena games found.</p>
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
                    {new Date(match.gameCreation).toLocaleString("en-GB")}
                  </span>
                </div>
                {me && (
                  <p className="mt-1 text-zinc-300">
                    <span className="font-medium text-zinc-100">{me.champion}</span> — {me.kills}/
                    {me.deaths}/{me.assists}
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
    </div>
  );
}
