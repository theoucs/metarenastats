import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { getChampionStats, type ChampionDetail } from "@/lib/aggregate";
import { resolveChampion, heroSplashUrl } from "@/lib/gameData";
import { readChampionDetailSnapshot, readSnapshot } from "@/lib/statsSnapshot";
import { getPatchContext } from "@/lib/patches";
import { PatchBadge } from "@/components/PatchBadge";
import { TierBadge } from "@/components/StatsTable";
import { computeTiers, type Tier } from "@/lib/tiers";
import { StatPill, avgPlacementColor, top1Color, top3Color } from "@/lib/statsDisplay";

/**
 * Le tronc commun des pages d'un champion.
 *
 * Une page de champion, c'est maintenant cinq pages : le résumé et un onglet par
 * sujet. Toutes montrent la même bannière, les mêmes pastilles et la même barre
 * d'onglets ; seul le contenu dessous change.
 *
 * Ce tronc est un composant et une fonction de chargement, et non un
 * `layout.tsx`. Un layout ne reçoit PAS les `searchParams` dans l'App Router —
 * or le patch affiché vient de `?patch=`, et c'est la bannière qui l'annonce.
 * Un layout aurait donc dû deviner ce que la page savait.
 */

export const CHAMPION_TABS = [
  { key: "summary", label: "Summary", href: "" },
  { key: "augments", label: "Augments", href: "/augments" },
  { key: "items", label: "Items", href: "/items" },
  { key: "combos", label: "Combos", href: "/combos" },
  { key: "anvil", label: "Anvil Run", href: "/anvil" },
] as const;

export type ChampionTabKey = (typeof CHAMPION_TABS)[number]["key"];

export type ChampionPageData = {
  slug: string;
  champInfo: NonNullable<ReturnType<typeof resolveChampion>>;
  detail: ChampionDetail | null;
  patch: string | null;
  /** Le `?patch=` tel qu'il a été demandé, à repasser aux liens d'onglets pour
   *  qu'un changement d'onglet ne ramène pas au patch par défaut. */
  patchParam: string | undefined;
  rank: { position: number; total: number; tier: Tier } | null;
};

/** Tout ce dont une page de champion a besoin, quel que soit l'onglet. */
export async function loadChampionPage(
  params: Promise<{ slug: string }>,
  searchParams: Promise<{ patch?: string }>,
): Promise<ChampionPageData> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const champInfo = resolveChampion(slug);
  if (!champInfo) notFound();

  const context = await getPatchContext();

  // Cette page est déjà dynamique (elle est rendue à la demande), donc lire un
  // paramètre d'URL ne lui coûte rien — contrairement aux tier lists, qui sont
  // statiques et basculent côté client. Le `?patch=` vient des liens de ces
  // tier lists : sans lui, cliquer un champion depuis une liste basculée
  // ramènerait au patch par défaut sans prévenir.
  const requested = query.patch;
  const shown =
    context.options.find((o) => o.patch === requested) ??
    context.options.find((o) => o.patch === context.defaultPatch) ??
    null;
  const patch = shown ? shown.patch : context.defaultPatch;

  // Site-wide champion stats come along for the ride so the header can say
  // where this champion actually sits — a tier badge and "#7 of 173" is the
  // one thing a build page header can tell you that the numbers below can't.
  const [detail, { champions }] = await Promise.all([
    readChampionDetailSnapshot(slug.toLowerCase(), patch),
    readSnapshot("champions", getChampionStats, patch),
  ]);

  const rows = champions.map((c) => ({
    key: resolveChampion(c.champion)?.id ?? c.champion,
    games: c.games,
    top3Rate: c.top3Rate,
    top1Rate: c.top1Rate,
    avgPlacement: c.avgPlacement,
  }));
  const tierMap = computeTiers(rows);
  const rank = tierMap.has(champInfo.id)
    ? (() => {
        const ordered = [...rows].sort(
          (a, b) => tierMap.get(b.key)!.score - tierMap.get(a.key)!.score,
        );
        return {
          position: ordered.findIndex((r) => r.key === champInfo.id) + 1,
          total: ordered.length,
          tier: tierMap.get(champInfo.id)!.tier,
        };
      })()
    : null;

  return { slug, champInfo, detail, patch, patchParam: requested, rank };
}

function ChampionTabNav({ data, active }: { data: ChampionPageData; active: ChampionTabKey }) {
  const query = data.patchParam ? `?patch=${encodeURIComponent(data.patchParam)}` : "";
  return (
    // Même boîte que les onglets de tier list (TieredStatsTabs) : ce sont des
    // liens et non des boutons, donc pas de pastille glissante — l'état actif
    // est peint directement, avec les mêmes couleurs, pour que les deux barres
    // se ressemblent au pixel près.
    <nav
      aria-label={`${data.champInfo.name} sections`}
      className="relative inline-flex flex-wrap rounded-lg border border-subtle bg-inset p-1"
    >
      {CHAMPION_TABS.map((tab) => {
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`/champions/${data.slug}${tab.href}${query}`}
            aria-current={current ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-small font-medium transition-[color,transform] duration-75 active:scale-[0.97] ${
              current
                ? "bg-overlay text-primary shadow-[var(--elev-2)]"
                : "text-muted hover:text-secondary"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** L'en-tête complet — bannière, pastilles, onglets — et le contenu de l'onglet. */
export function ChampionShell({
  data,
  active,
  children,
}: {
  data: ChampionPageData;
  active: ChampionTabKey;
  children: ReactNode;
}) {
  const { champInfo, detail, patch, rank } = data;

  return (
    <div>
      {/* Taller by the same 24px the name block gained in bottom padding, so
          the extra breathing room comes out of the banner rather than pushing
          the name up off the scrim's solid zone and onto the splash art. */}
      <div className="relative h-[264px] w-full overflow-hidden bg-raised sm:h-[324px]">
        {/* `centered` (1280x720), not `loading` (308x560): the loading art is a
            portrait crop that had to be upscaled ~4.7x to span a wide banner,
            which is what turned this header into a grey smear. The centered
            splash is already landscape and near 1:1 at this size. object-top
            would cut foreheads on a 720px-tall source, so bias just below
            center where splash art puts the face. Uses the champion's most
            popular skin (same pick as the homepage hero) rather than the base
            splash — the base splash next to the base square icon just below
            is the same art twice. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={heroSplashUrl(champInfo.id)}
          alt=""
          width={1280}
          height={720}
          className="absolute inset-0 h-full w-full object-cover object-[center_28%]"
        />
        {/* Two scrims, each doing one job. Vertical: from-15% keeps the art
            visible almost to the bottom edge — the pills that overlap it are
            translucent-with-blur by design now, so the splash showing through
            between them is the effect, not a bug. Horizontal: keeps the name
            legible over whatever the art happens to be doing on the left, while
            leaving the right side of the splash actually visible. */}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base)] from-15% via-[var(--bg-base)]/55 via-55% to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-base)]/90 via-[var(--bg-base)]/30 via-45% to-transparent" />
        {/* The name now sits *on* the art rather than on the solid strip the old
            scrim guaranteed below it. The pills overlap the banner by 48px
            (-mt-12), so the padding here has to clear that overlap *plus* a
            real gap: at pb-8 the pills sat straight on top of "Rank #1 of 173".
            80 - 48 = 32px of visible air under the name. */}
        <div className="relative mx-auto flex h-full max-w-6xl items-end px-4 pb-20 sm:px-6">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={champInfo.iconUrl}
              alt=""
              className="h-16 w-16 rounded-xl border border-strong object-cover shadow-[var(--elev-3)]"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className="font-display text-display font-semibold tracking-tight text-primary drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                  {champInfo.name}
                </h1>
                {rank && <TierBadge tier={rank.tier} />}
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-secondary">
                {rank ? (
                  <span>
                    Rank <span className="font-mono tabular-nums text-primary">#{rank.position}</span>{" "}
                    of {rank.total} champions
                  </span>
                ) : (
                  <span>Arena build summary</span>
                )}
                {patch && <PatchBadge patch={patch} games={detail?.games} />}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6 sm:pb-12">
        {/* relative + z-10: the banner above is `position: relative` (for its
            absolute img/scrim children) — CSS paints positioned elements above
            non-positioned siblings regardless of DOM order, so without this,
            the banner silently wins the overlap and swallows whatever pokes
            up into it (e.g. the stat pill labels, which sit higher in each
            pill than the value). Making this positioned too puts DOM order
            back in charge, and it comes after the banner in the DOM. */}
        <div className="relative z-10 -mt-12">
          {!detail ? (
            <div className="rounded-lg border border-subtle bg-raised/40 p-10 text-center text-secondary">
              No data yet for {champInfo.name}. Search a player who played this champion to start
              populating stats.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 [&>*:first-child]:col-span-2 sm:grid-cols-5 sm:[&>*:first-child]:col-span-1">
                <StatPill
                  label="Avg Placement"
                  value={detail.avgPlacement.toFixed(2)}
                  colorClass={avgPlacementColor(detail.avgPlacement)}
                  emphasis
                />
                <StatPill
                  label="% Top 1"
                  value={`${(detail.top1Rate * 100).toFixed(1)}%`}
                  colorClass={top1Color(detail.top1Rate)}
                />
                <StatPill
                  label="% Top 3"
                  value={`${(detail.top3Rate * 100).toFixed(1)}%`}
                  colorClass={top3Color(detail.top3Rate)}
                />
                <StatPill label="% Played" value={`${(detail.playRate * 100).toFixed(1)}%`} />
              </div>

              <div className="mt-8">
                <ChampionTabNav data={data} active={active} />
              </div>

              {children}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** L'en-tête d'un onglet : son titre et la phrase qui dit ce qu'on regarde. */
export function TabHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mt-8 border-t border-subtle pt-8">
      <h2 className="font-display text-h2 font-semibold text-primary">{title}</h2>
      {children && <p className="mt-1 text-small text-secondary">{children}</p>}
    </div>
  );
}
