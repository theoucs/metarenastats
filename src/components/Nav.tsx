"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { Wordmark } from "@/components/Wordmark";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/champions", label: "Champions" },
  { href: "/items", label: "Items" },
  { href: "/augments", label: "Augments" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/info", label: "Info & Tips" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-50">
          <LogoMark />
          <Wordmark />
        </Link>
        <ul className="flex flex-1 items-center gap-1 text-sm">
          {LINKS.slice(1).map((link) => {
            const active = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-zinc-800/80 text-zinc-50"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
