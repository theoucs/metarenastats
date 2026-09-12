"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchEntities } from "@/lib/searchIndex";

export function HomeSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isMac, setIsMac] = useState<boolean | null>(null);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
  }, []);

  // Same ⌘K / Ctrl+K shortcut as the header's NavSearch, so it works
  // everywhere — including here, where NavSearch is hidden in favor of
  // this bigger hero input.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        setFocused(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search a player (Name#TAG), champion, item or augment..."
          className="w-full rounded-xl border border-subtle bg-inset px-5 py-3.5 text-base text-primary outline-none placeholder:text-muted focus:border-accent sm:[--hint-pad:4rem]"
          style={{ paddingRight: isMac !== null && !focused ? "var(--hint-pad, 1.25rem)" : undefined }}
        />
        {isMac !== null && !focused && (
          <span className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded border border-subtle bg-raised px-1.5 py-0.5 text-micro text-muted sm:block">
            {isMac ? "⌘K" : "Ctrl K"}
          </span>
        )}

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
