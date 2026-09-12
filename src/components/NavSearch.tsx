"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchEntities } from "@/lib/searchIndex";

// Compact search that lives in the site header on every page — same data/
// destinations as the big HomeSearch on the landing page, just styled small
// and unobtrusive like most sites' header search (GitHub, Notion, etc.).
export function NavSearch({
  onNavigate,
  showShortcut = true,
}: {
  onNavigate?: () => void;
  /** Hide the ⌘K hint — set false for the mobile menu instance, which has no
   * physical keyboard and no room for it (per design-refresh-plan.md §4.6). */
  showShortcut?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [isMac, setIsMac] = useState<boolean | null>(null);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
  }, []);

  // ⌘K (macOS) / Ctrl+K focuses the search input from anywhere on the page;
  // Escape blurs it. preventDefault on the K shortcut so it doesn't trigger
  // the browser's own address-bar search.
  useEffect(() => {
    if (!showShortcut) return;
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
  }, [showShortcut]);

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
    <div className="relative w-full md:w-44 xl:w-56">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
            aria-hidden
          >
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M17.5 17.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Search player, champion..."
            className="w-full rounded-lg border border-subtle bg-inset py-1.5 pl-8 text-small text-primary placeholder:text-muted focus:border-accent"
            style={{ paddingRight: showShortcut && isMac !== null && !focused ? "3.25rem" : "0.75rem" }}
          />
          {showShortcut && isMac !== null && !focused && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-subtle bg-raised px-1.5 py-0.5 text-micro text-muted">
              {isMac ? "⌘K" : "Ctrl K"}
            </span>
          )}
        </div>
      </form>

      {focused && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-80 overflow-y-auto rounded-lg border border-subtle bg-overlay text-left shadow-[var(--elev-3)]">
          {suggestions.map((s) => (
            <li key={`${s.type}-${s.id}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => goTo(s.href)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-small hover:bg-[color:var(--accent-muted)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.iconUrl} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
                <span className="truncate text-primary">{s.name}</span>
                <span className="ml-auto shrink-0 text-micro uppercase tracking-wide text-muted">
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
