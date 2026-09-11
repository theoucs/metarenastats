import Link from "next/link";
import { getSiteStats, getChampionStats } from "@/lib/aggregate";
import { computeTiers } from "@/lib/tiers";
import { resolveChampion } from "@/lib/gameData";
import { EntityIcon, top3Color } from "@/lib/statsDisplay";
import { TierBadge } from "@/components/StatsTable";
import { HomeSearch } from "@/components/HomeSearch";
import { LogoMark } from "@/components/Logo";
import { Wordmark } from "@/components/Wordmark";

export const dynamic = "force-dynamic";

export default async function Home() {
  // getChampionStats() is already called by /champions and is cheap — do not
  // add getComboStats() here, it's ~2.4s (builds every participant pairing)
  // and would make the homepage the slow page on the site.
  const [{ totalMatches, totalChampions, totalPlayers }, { champions }] = await Promise.all([
    getSiteStats(),
    getChampionStats(),
  ]);

  const rows = champions.map((c) => {
    const info = resolveChampion(c.champion);
    return {
      key: info?.id ?? c.champion,
      name: info?.name ?? c.champion,
      iconUrl: info?.iconUrl,
      games: c.games,
      top3Rate: c.top3Rate,
      top1Rate: c.top1Rate,
      avgPlacement: c.avgPlacement,
    };
  });
  const tierMap = computeTiers(rows);
  const topChampions = [...rows]
    .sort((a, b) => tierMap.get(a.key)!.score - tierMap.get(b.key)!.score)
    .slice(0, 5);

  return (
    <div className="relative overflow-hidden">
      {/* Concentric rings, not a repeated pattern — evokes an arena viewed
          from above. 4% opacity ceiling per design-refresh-plan.md §5.1. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center text-primary opacity-[0.04]"
        aria-hidden
      >
        <svg width="900" height="480" viewBox="0 0 900 480" fill="none">
          <circle cx="450" cy="0" r="120" stroke="currentColor" />
          <circle cx="450" cy="0" r="220" stroke="currentColor" />
          <circle cx="450" cy="0" r="320" stroke="currentColor" />
          <circle cx="450" cy="0" r="420" stroke="currentColor" />
        </svg>
      </div>

      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 pb-6 pt-20 text-center sm:pt-24">
        <LogoMark className="h-14 w-14" />
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-primary sm:text-5xl">
          <Wordmark />
        </h1>
        <p className="mt-4 max-w-xl text-balance text-secondary">
          Free stats, tier lists and leaderboards for League of Legends Arena — the 3v3 &quot;Three
          by Six&quot; mode.
        </p>

        <div className="mt-10 w-full">
          <HomeSearch />
        </div>
      </div>

      <div className="relative mx-auto max-w-4xl px-4 pb-20 sm:px-6">
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="font-display text-h2 font-semibold text-primary">Meta Snapshot</h2>
            <Link href="/champions" className="text-small text-accent hover:underline">
              Full tier list →
            </Link>
          </div>
          <p className="mt-1 text-small text-muted">
            <span className="text-secondary">{totalMatches}</span> matches ·{" "}
            <span className="text-secondary">{totalChampions}</span> champions ·{" "}
            <span className="text-secondary">{totalPlayers}</span> players tracked
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {topChampions.map((c) => (
              <Link
                key={c.key}
                href={`/champions/${c.key}`}
                className="flex flex-col items-center gap-2 rounded-lg border border-subtle bg-raised/40 p-4 text-center transition-colors hover:bg-overlay"
              >
                {c.iconUrl && <EntityIcon iconUrl={c.iconUrl} sizeClass="h-12 w-12" />}
                <span className="text-body font-medium text-primary">{c.name}</span>
                <div className="flex items-center gap-1.5">
                  <TierBadge tier={tierMap.get(c.key)!.tier} />
                  <span className={`font-mono text-small ${top3Color(c.top3Rate)}`}>
                    {(c.top3Rate * 100).toFixed(0)}%
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
