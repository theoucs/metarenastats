"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { searchEntities } from "@/lib/searchIndex";
import { MatchCard, type MatchCardData } from "@/components/MatchCard";

type ApiResponse = {
  account?: { gameName: string; tagLine: string };
  matches?: MatchCardData[];
  error?: string;
};

export function HomeSearch() {
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
    <div className="flex w-full flex-col items-center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          searchPlayer(query);
        }}
        className="relative w-full max-w-xl"
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
          {data.matches.map((match) => (
            <MatchCard key={match.matchId} match={match} />
          ))}
        </div>
      )}
    </div>
  );
}
