import Link from "next/link";
import { getSiteStats, getChampionStats } from "@/lib/aggregate";
import { computeTiers, type Tier } from "@/lib/tiers";
import { resolveChampion, heroSplashUrl } from "@/lib/gameData";
import { EntityIcon, top3Color } from "@/lib/statsDisplay";
import { TierBadge } from "@/components/StatsTable";
import { HomeSearch } from "@/components/HomeSearch";
import { Wordmark } from "@/components/Wordmark";

export const dynamic = "force-dynamic";

type TopChampion = {
  key: string;
  name: string;
  iconUrl?: string;
  top3Rate: number;
  avgPlacement: number;
  games: number;
  tier: Tier;
};

/**
 * The top 3, as portrait cards with the champion's own art.
 *
 * `centered` (1280x720) even though these cards are portrait: the obvious
 * choice, `loading` (308x560), ships with a decorative border baked into the
 * bitmap, which reads as a stray light rectangle inside the card. Cropping the
 * middle of the centered splash costs nothing here — it's centered on the
 * champion by definition — and gives ~2x the pixels besides.
 */
function ChampionSpotlight({ champion, rank }: { champion: TopChampion; rank: number }) {
  // Landscape on phones: three stacked portraits would put ~1400px of champion
  // art between the fold and the rest of the page. The source is landscape
  // anyway, so the 3/2 phone crop shows more of it, not less.
  return (
    <Link
      href={`/champions/${champion.key}`}
      className="group relative flex aspect-[3/2] overflow-hidden rounded-xl border border-subtle shadow-[var(--elev-2)] transition-colors hover:border-strong sm:aspect-[3/4]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://ddragon.leagueoflegends.com/cdn/img/champion/centered/${champion.key}_0.jpg`}
        alt=""
        width={1280}
        height={720}
        className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base)] from-15% via-[var(--bg-base)]/55 via-55% to-transparent" />

      <span className="absolute left-3 top-3 rounded-md border border-subtle bg-[var(--bg-base)]/70 px-1.5 py-0.5 font-mono text-micro tabular-nums text-secondary backdrop-blur-sm">
        #{rank}
      </span>

      <div className="relative mt-auto w-full p-3.5">
        <div className="flex items-center gap-2">
          <TierBadge tier={champion.tier} />
          <span className="min-w-0 truncate font-display text-h1 font-semibold text-primary">
            {champion.name}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-small tabular-nums">
          <span className={top3Color(champion.top3Rate)}>
            {(champion.top3Rate * 100).toFixed(1)}%
          </span>
          <span className="text-micro uppercase tracking-wide text-muted">top 3</span>
          <span className="text-muted">·</span>
          <span className="text-secondary">{champion.avgPlacement.toFixed(2)}</span>
          <span className="text-micro uppercase tracking-wide text-muted">avg</span>
        </div>
      </div>
    </Link>
  );
}

function ChampionChip({ champion, rank }: { champion: TopChampion; rank: number }) {
  return (
    <Link
      href={`/champions/${champion.key}`}
      className="flex items-center gap-2.5 rounded-lg border border-subtle bg-raised/40 p-2.5 transition-colors hover:border-default hover:bg-overlay"
    >
      <span className="w-3 shrink-0 font-mono text-micro tabular-nums text-muted">{rank}</span>
      {champion.iconUrl && <EntityIcon iconUrl={champion.iconUrl} sizeClass="h-9 w-9" />}
      {/* No tier badge here on purpose: everything in the top 8 is the same
          tier by construction, so the badge would be five identical pills
          eating the width the champion name actually needs. */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-small font-medium text-primary">{champion.name}</div>
        <div className="whitespace-nowrap font-mono text-micro tabular-nums text-muted">
          <span className={top3Color(champion.top3Rate)}>
            {(champion.top3Rate * 100).toFixed(0)}%
          </span>{" "}
          top 3
        </div>
      </div>
    </Link>
  );
}

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
  const topChampions: TopChampion[] = [...rows]
    .sort((a, b) => tierMap.get(b.key)!.score - tierMap.get(a.key)!.score)
    .slice(0, 8)
    .map((c) => ({ ...c, tier: tierMap.get(c.key)!.tier }));

  const podium = topChampions.slice(0, 3);
  const runnersUp = topChampions.slice(3);

  return (
    <div>
      {/* Hero. Left-aligned and art-backed on purpose: a centered
          logo/wordmark/tagline/search stack is the default landing-page
          template, and it pushed the first real content below the fold. */}
      <section className="relative isolate overflow-hidden border-b border-subtle">
        {podium[0] && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroSplashUrl(podium[0].key)}
              alt=""
              width={1280}
              height={720}
              className="absolute inset-y-0 right-0 hidden h-full w-[58%] object-cover object-[center_25%] md:block"
            />
            {/* Left-to-right scrim over the art, then a bottom fade so it
                doesn't end on a hard horizontal line above the fold. */}
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-base)] from-30% via-[var(--bg-base)]/85 via-55% to-[var(--bg-base)]/45" />
            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[var(--bg-base)] to-transparent" />
          </>
        )}

        {/* No decorative rings here. They existed to give a text-only hero
            something to look at; now that the splash art carries it, thin arcs
            crossing the tagline just read as a rendering artefact. */}

        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <p className="text-micro font-semibold uppercase tracking-[0.18em] text-muted">
            League of Legends Arena · 3v3 Three by Six
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-primary sm:text-display-lg">
            <Wordmark />
          </h1>
          <p className="mt-3 max-w-md text-balance text-secondary">
            Free champion, item and augment tier lists — built from real tracked matches.
          </p>

          <div className="mt-8 max-w-xl">
            <HomeSearch />
          </div>

          <p className="mt-4 font-mono text-small tabular-nums text-muted">
            <span className="text-secondary">{totalMatches}</span> matches ·{" "}
            <span className="text-secondary">{totalChampions}</span> champions ·{" "}
            <span className="text-secondary">{totalPlayers}</span> players tracked
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-display text-h1 font-semibold text-primary">Meta Snapshot</h2>
          <Link href="/champions" className="text-small text-accent hover:underline">
            Full tier list →
          </Link>
        </div>
        <p className="mt-1 text-small text-muted">
          Highest-scoring champions right now, by tier score.
        </p>

        {podium.length > 0 && (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {podium.map((c, i) => (
              <ChampionSpotlight key={c.key} champion={c} rank={i + 1} />
            ))}
          </div>
        )}

        {runnersUp.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {runnersUp.map((c, i) => (
              <ChampionChip key={c.key} champion={c} rank={i + 4} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
