"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { Wordmark } from "@/components/Wordmark";
import { NavSearch } from "@/components/NavSearch";

const LINKS: { href: string; label: string; badge?: string }[] = [
  { href: "/", label: "Home" },
  { href: "/champions", label: "Champions" },
  // Kept apart from "Combos" in the ordering on purpose — Team Comps is three
  // champions, Combos is two items/augments, and the names are close enough
  // that sitting them side by side would read as one feature split in two.
  { href: "/comps", label: "Team Comps" },
  { href: "/items", label: "Items" },
  { href: "/augments", label: "Augments" },
  { href: "/combos", label: "Combos", badge: "New" },
  { href: "/anvil", label: "Anvil Run", badge: "New" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/info", label: "Info & Tips" },
];

function NavLink({
  href,
  label,
  badge,
  active,
  onClick,
  linkRef,
  staticActiveBg,
}: {
  href: string;
  label: string;
  badge?: string;
  active: boolean;
  onClick?: () => void;
  linkRef?: (el: HTMLAnchorElement | null) => void;
  /** Give the active link its own background instead of relying on a sliding
   * highlight from a parent — used by the mobile dropdown, which stacks
   * vertically and has no animated indicator of its own. */
  staticActiveBg?: boolean;
}) {
  return (
    <Link
      ref={linkRef}
      href={href}
      onClick={onClick}
      // whitespace-nowrap: without it a tight nav breaks *inside* a label
      // ("Team / Comps", "Anvil / Run"), which also makes the sliding highlight
      // two lines tall. Better to let the row run out of room than to hyphenate
      // the navigation.
      className={`relative z-10 flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors ${
        active
          ? staticActiveBg
            ? "bg-overlay text-primary"
            : "text-primary"
          : "text-muted hover:bg-overlay/60 hover:text-secondary"
      }`}
    >
      {label}
      {badge && (
        <span className="rounded-full border border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-accent">
          {badge}
        </span>
      )}
    </Link>
  );
}

// Sliding highlight behind the active top-level link, synced to the current
// route — a translate/resize animation reads as far less "templated" than an
// instant background swap (design-refresh-plan.md §4.5/§4.6).
function NavLinkList({ pathname }: { pathname: string }) {
  const listRef = useRef<HTMLUListElement>(null);
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [highlight, setHighlight] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = linkRefs.current.get(pathname);
    setHighlight(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [pathname]);

  return (
    <ul ref={listRef} className="relative hidden flex-1 items-center gap-0.5 text-sm xl:flex">
      {highlight && (
        <div
          className="absolute inset-y-0 z-0 rounded-md bg-overlay shadow-[var(--elev-1)] transition-[left,width] duration-[250ms] ease-out motion-reduce:transition-none"
          style={{ left: highlight.left, width: highlight.width }}
        />
      )}
      {LINKS.slice(1).map((link) => (
        <li key={link.href}>
          <NavLink
            href={link.href}
            label={link.label}
            badge={link.badge}
            active={pathname === link.href}
            linkRef={(el) => {
              if (el) linkRefs.current.set(link.href, el);
              else linkRefs.current.delete(link.href);
            }}
          />
        </li>
      ))}
    </ul>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // The home page already has its own big, prominent search — skip the
  // duplicate compact one there.
  const showSearch = pathname !== "/";

  // Close the mobile menu whenever the route actually changes (not on every
  // render — otherwise it'd never be able to stay open).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 4);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b bg-[color:var(--bg-base)]/80 backdrop-blur-md transition-colors duration-150 ${
        scrolled ? "border-default" : "border-subtle"
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-primary"
        >
          <LogoMark />
          <Wordmark />
        </Link>

        <NavLinkList pathname={pathname} />

        {showSearch && (
          <div className="hidden xl:block">
            <NavSearch />
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-secondary hover:bg-overlay xl:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
            {open ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </nav>

      {open && (
        <div className="border-t border-subtle px-4 py-3 xl:hidden">
          {showSearch && (
            <div className="mb-3">
              <NavSearch onNavigate={() => setOpen(false)} showShortcut={false} />
            </div>
          )}
          <ul className="flex flex-col gap-1 text-sm">
            {LINKS.slice(1).map((link) => (
              <li key={link.href}>
                <NavLink
                  href={link.href}
                  label={link.label}
                  badge={link.badge}
                  active={pathname === link.href}
                  onClick={() => setOpen(false)}
                  staticActiveBg
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
