"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { Wordmark } from "@/components/Wordmark";
import { NavSearch } from "@/components/NavSearch";

const LINKS: { href: string; label: string; badge?: string }[] = [
  { href: "/", label: "Home" },
  { href: "/champions", label: "Champions" },
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
}: {
  href: string;
  label: string;
  badge?: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors ${
        active ? "bg-zinc-800/80 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      }`}
    >
      {label}
      {badge && (
        <span className="rounded-full bg-gradient-to-r from-blue-500 to-violet-500 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-white">
          {badge}
        </span>
      )}
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The home page already has its own big, prominent search — skip the
  // duplicate compact one there.
  const showSearch = pathname !== "/";

  // Close the mobile menu whenever the route actually changes (not on every
  // render — otherwise it'd never be able to stay open).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-50"
        >
          <LogoMark />
          <Wordmark />
        </Link>

        <ul className="hidden flex-1 items-center gap-0.5 text-sm xl:flex">
          {LINKS.slice(1).map((link) => (
            <li key={link.href}>
              <NavLink
                href={link.href}
                label={link.label}
                badge={link.badge}
                active={pathname === link.href}
              />
            </li>
          ))}
        </ul>

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
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-900 xl:hidden"
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
        <div className="border-t border-zinc-800/80 px-4 py-3 xl:hidden">
          {showSearch && (
            <div className="mb-3">
              <NavSearch onNavigate={() => setOpen(false)} />
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
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
