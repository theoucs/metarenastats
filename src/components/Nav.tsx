"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { Wordmark } from "@/components/Wordmark";
import { NavSearch } from "@/components/NavSearch";

type NavItem = { href: string; label: string };

// Five of the seven pages are tier lists; listing them flat made an 8-link bar
// that only fitted from 1280px up. They live under one menu now (decided with
// Théo, 2026-09-28), and Info & Tips moved to the footer.
const TIER_LISTS: NavItem[] = [
  { href: "/items", label: "Items" },
  { href: "/augments", label: "Augments" },
  // Kept apart from "Combos" in the ordering on purpose: Team Comps is three
  // champions, Combos is two items/augments, and side by side the names read
  // as one feature split in two.
  { href: "/comps", label: "Team Comps" },
  { href: "/anvil", label: "Anvil Run" },
  { href: "/combos", label: "Combos" },
];
const CHAMPIONS: NavItem = { href: "/champions", label: "Champions" };
const LEADERBOARD: NavItem = { href: "/leaderboard", label: "Leaderboard" };
const TIER_LISTS_KEY = "tier-lists";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const linkBase =
  "relative z-10 flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors";

function NavLink({
  item,
  active,
  onClick,
  linkRef,
  staticActiveBg,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
  linkRef?: (el: HTMLElement | null) => void;
  /** Give the active link its own background instead of relying on a sliding
   * highlight from a parent, for the mobile menu, which has no animated
   * indicator of its own. */
  staticActiveBg?: boolean;
}) {
  return (
    <Link
      ref={linkRef}
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`${linkBase} ${
        active
          ? staticActiveBg
            ? "bg-overlay text-primary"
            : "text-primary"
          : "text-muted hover:bg-overlay/60 hover:text-secondary"
      }`}
    >
      {item.label}
    </Link>
  );
}

/**
 * The "Tier lists" menu. A disclosure (button + list of links), not an ARIA
 * `menu`: its items are plain navigation links, so Tab keeps working as
 * everywhere else. Arrow keys move between them as a convenience, Escape
 * closes and gives focus back to the button, a click outside closes.
 */
function TierListsMenu({
  pathname,
  buttonRef,
}: {
  pathname: string;
  buttonRef: (el: HTMLElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const active = TIER_LISTS.some((item) => isActive(pathname, item.href));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && open) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (!open) {
      setOpen(true);
      requestAnimationFrame(() => itemRefs.current[0]?.focus());
      return;
    }
    const items = itemRefs.current.filter(Boolean) as HTMLAnchorElement[];
    const at = items.indexOf(document.activeElement as HTMLAnchorElement);
    const next = e.key === "ArrowDown" ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={onKeyDown}
      // Tabbing out of the menu closes it, so it never stays open behind the
      // focus.
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={(el) => {
          triggerRef.current = el;
          buttonRef(el);
        }}
        type="button"
        aria-expanded={open}
        aria-controls="tier-lists-menu"
        onClick={() => setOpen((o) => !o)}
        className={`${linkBase} ${active ? "text-primary" : "text-muted hover:bg-overlay/60 hover:text-secondary"}`}
      >
        Tier lists
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`h-3 w-3 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ul
        id="tier-lists-menu"
        hidden={!open}
        className="absolute left-0 top-full z-50 mt-2 min-w-48 rounded-lg border border-subtle bg-overlay p-1.5 shadow-[var(--elev-3)]"
      >
        {TIER_LISTS.map((item, i) => {
          const current = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={current ? "page" : undefined}
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  current ? "bg-raised text-primary" : "text-secondary hover:bg-raised hover:text-primary"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Sliding highlight behind the active top-level entry, synced to the current
// route: a translate/resize animation reads as far less templated than an
// instant background swap.
function NavLinkList({ pathname }: { pathname: string }) {
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [highlight, setHighlight] = useState<{ left: number; width: number } | null>(null);
  const setRef = (key: string) => (el: HTMLElement | null) => {
    if (el) itemRefs.current.set(key, el);
    else itemRefs.current.delete(key);
  };
  const activeKey = isActive(pathname, CHAMPIONS.href)
    ? CHAMPIONS.href
    : isActive(pathname, LEADERBOARD.href)
      ? LEADERBOARD.href
      : TIER_LISTS.some((item) => isActive(pathname, item.href))
        ? TIER_LISTS_KEY
        : null;

  const listRef = useRef<HTMLUListElement>(null);

  // Measured against the list itself, not with offsetLeft: the Tier lists
  // button sits inside its own positioned wrapper, so its offsetLeft is 0 and
  // the highlight landed on Champions.
  useLayoutEffect(() => {
    const el = activeKey ? itemRefs.current.get(activeKey) : undefined;
    const list = listRef.current;
    if (!el || !list) {
      setHighlight(null);
      return;
    }
    const left = el.getBoundingClientRect().left - list.getBoundingClientRect().left;
    setHighlight({ left, width: el.offsetWidth });
  }, [activeKey]);

  return (
    <ul ref={listRef} className="relative hidden items-center gap-1 text-sm md:flex">
      {highlight && (
        <div
          className="absolute inset-y-0 z-0 rounded-md bg-overlay shadow-[var(--elev-1)] transition-[left,width] duration-[250ms] ease-out motion-reduce:transition-none"
          style={{ left: highlight.left, width: highlight.width }}
        />
      )}
      <li>
        <NavLink item={CHAMPIONS} active={activeKey === CHAMPIONS.href} linkRef={setRef(CHAMPIONS.href)} />
      </li>
      <li>
        <TierListsMenu pathname={pathname} buttonRef={setRef(TIER_LISTS_KEY)} />
      </li>
      <li>
        <NavLink item={LEADERBOARD} active={activeKey === LEADERBOARD.href} linkRef={setRef(LEADERBOARD.href)} />
      </li>
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
          // `group` drives the die roll in Logo.tsx — hovering anywhere on the
          // brand (mark *or* wordmark) rolls it, so the two read as one target.
          className="group flex items-center gap-2 text-sm font-semibold tracking-tight text-primary"
        >
          <LogoMark />
          <Wordmark />
        </Link>

        <NavLinkList pathname={pathname} />

        {/* Three entries leave room for the search from md up, pushed to the
            right edge. Below md both the links and the search go behind the
            burger. */}
        {showSearch && (
          <div className="ml-auto hidden md:block">
            <NavSearch />
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-secondary transition-colors hover:bg-overlay active:scale-[0.97] md:hidden"
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

      {/* Always mounted and animated by grid-template-rows: `{open && …}`
          popped in and out with no transition at all. `inert` keeps the
          collapsed copy out of the tab order and the accessibility tree. */}
      <div
        inert={!open}
        className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none md:hidden ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        {/* Three levels on purpose: the grid item itself must carry no padding
            or border, otherwise they survive the 0fr track and leave a ~25px
            strip under the header while "closed". All spacing lives inside. */}
        <div className="overflow-hidden">
          <div className="border-t border-subtle px-4 py-3">
            {/* The header already shows NavSearch from md up, so only the
                sub-md dropdown needs its own copy. */}
            {showSearch && (
              <div className="mb-3 md:hidden">
                <NavSearch onNavigate={() => setOpen(false)} showShortcut={false} />
              </div>
            )}
            <ul className="flex flex-col gap-1 text-sm">
              <li>
                <NavLink item={CHAMPIONS} active={isActive(pathname, CHAMPIONS.href)} onClick={() => setOpen(false)} staticActiveBg />
              </li>
            </ul>
            <p className="mt-3 px-2.5 text-micro text-muted">Tier lists</p>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {TIER_LISTS.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(pathname, item.href)} onClick={() => setOpen(false)} staticActiveBg />
                </li>
              ))}
            </ul>
            <ul className="mt-3 flex flex-col gap-1 border-t border-subtle pt-3 text-sm">
              <li>
                <NavLink item={LEADERBOARD} active={isActive(pathname, LEADERBOARD.href)} onClick={() => setOpen(false)} staticActiveBg />
              </li>
            </ul>
          </div>
        </div>
      </div>
    </header>
  );
}
