"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { searchEntities } from "@/lib/searchIndex";

// Compact search that lives in the site header on every page — same data/
// destinations as the big HomeSearch on the landing page, just styled small
// and unobtrusive like most sites' header search (GitHub, Notion, etc.).
export function NavSearch({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const isPlayerQuery = query.includes("#");
  const suggestions = useMemo(
    () => (isPlayerQuery ? [] : searchEntities(query)),
    [query, isPlayerQuery]
  );

  function goTo(href: string) {
    router.push(href);
    setQuery("");
    setFocused(false);
    onNavigate?.();
  }

  function submit() {
    if (isPlayerQuery) {
      goTo(`/players/${encodeURIComponent(query.trim())}`);
    } else if (suggestions[0]) {
      goTo(suggestions[0].href);
    }
  }

  return (
    <div className="relative w-full md:w-56">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Search player, champion..."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-blue-500"
        />
      </form>

      {focused && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-80 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 text-left shadow-2xl">
          {suggestions.map((s) => (
            <li key={`${s.type}-${s.id}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => goTo(s.href)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-zinc-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.iconUrl} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
                <span className="truncate text-zinc-100">{s.name}</span>
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
                  {s.type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
