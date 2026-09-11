"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchEntities } from "@/lib/searchIndex";

export function HomeSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  const isPlayerQuery = query.includes("#");
  const suggestions = useMemo(
    () => (isPlayerQuery ? [] : searchEntities(query)),
    [query, isPlayerQuery]
  );

  function searchPlayer(riotId: string) {
    if (!riotId.includes("#")) return;
    startTransition(() => {
      router.push(`/players/${encodeURIComponent(riotId)}`);
    });
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
          className="w-full rounded-xl border border-subtle bg-inset px-5 py-3.5 text-base text-primary outline-none placeholder:text-muted focus:border-accent"
        />

        {suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-subtle bg-overlay text-left shadow-[var(--elev-3)]">
            {suggestions.map((s) => (
              <li key={`${s.type}-${s.id}`}>
                <button
                  type="button"
                  onClick={() => router.push(s.href)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-[color:var(--accent-muted)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.iconUrl} alt="" className="h-7 w-7 rounded-md object-cover" />
                  <span className="text-primary">{s.name}</span>
                  <span className="ml-auto text-micro uppercase tracking-wide text-muted">
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
            disabled={isPending}
            className="mt-3 w-full rounded-lg bg-accent px-5 py-2.5 font-medium text-[#05131a] transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {isPending ? "Searching..." : "Search player"}
          </button>
        )}
      </form>
    </div>
  );
}
