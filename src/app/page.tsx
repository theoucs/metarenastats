import Link from "next/link";
import { getSiteStats, getChampionStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { getPatchContext } from "@/lib/patches";
import { computeTiers, type Tier } from "@/lib/tiers";
import { resolveChampion, heroSplashUrl } from "@/lib/gameData";
import { EntityIcon, top3Color, avgPlacementColor } from "@/lib/statsDisplay";
import { TierBadge } from "@/components/StatsTable";
import { HomeSearch } from "@/components/HomeSearch";
import { Wordmark } from "@/components/Wordmark";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

const EXPLORE = [
  { href: "/items", title: "Items", blurb: "Legendary and prismatic, split by rarity." },
  { href: "/augments", title: "Augments", blurb: "Silver, gold and prismatic tier lists." },
  { href: "/combos", title: "Combos", blurb: "Pairs that actually place together." },
  { href: "/comps", title: "Team Comps", blurb: "Which three-champion shapes place." },
] as const;

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
  // Landscape on phones, and flatter than the source: three stacked portraits
  // would put ~1400px of champion art between the fold and the rest of the
  // page. At 3/2 a single card was still ~500px tall on a 390px screen — three
  // swipes to see a top 3 on a site built for checking between games.
  return (
    <Link
      href={`/champions/${champion.key}`}
      className="group relative flex aspect-[16/9] overflow-hidden rounded-xl border border-subtle shadow-[var(--elev-2)] transition-colors hover:border-strong sm:aspect-[3/4]"
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
        {/* Avg placement leads here too — see docs/design-audit-plan.md §3.6. */}
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-small tabular-nums">
          <span className={avgPlacementColor(champion.avgPlacement)}>
            {champion.avgPlacement.toFixed(2)}
          </span>
          <span className="text-micro uppercase tracking-wide text-muted">avg</span>
          <span className="text-muted">·</span>
          <span className={top3Color(champion.top3Rate)}>
            {(champion.top3Rate * 100).toFixed(1)}%
          </span>
          <span className="text-micro uppercase tracking-wide text-muted">top 3</span>
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
          <span className={avgPlacementColor(champion.avgPlacement)}>
            {champion.avgPlacement.toFixed(2)}
          </span>{" "}
          avg
        </div>
      </div>
    </Link>
  );
}

export default async function Home() {
  // getChampionStats() is already called by /champions and is cheap — do not
  // add getComboStats() here, it's ~2.4s (builds every participant pairing)
  // and would make the homepage the slow page on the site.
  // Les compteurs du site restent sur TOUT l'historique — « 2 087 matchs
  // suivis » parle de ce que le site connaît, pas du patch courant. La tier
  // list, elle, suit le patch affiché.
  const patch = await getPatchContext();
  const [{ totalMatches, totalChampions, totalPlayers }, { champions }] = await Promise.all([
    readSnapshot("site", getSiteStats),
    readSnapshot("champions", getChampionStats, patch.defaultPatch),
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
              className="absolute inset-y-0 right-0 hidden h-full w-[58%] object-cover object-[center_25%] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,#000_28%)] [mask-image:linear-gradient(to_right,transparent_0%,#000_28%)] md:block"
            />
            {/* Le bord GAUCHE de l'image se dissout par un masque.
                L'image occupe les 58 % de droite, donc son bord gauche tombe à
                42 % de la largeur. Le voile horizontal ci-dessous y est opaque
                à ~93 %, pas à 100 % : il restait donc 7 % d'image d'un côté du
                trait et 0 % de l'autre. Mesuré sur une capture : 10,81 à
                41,8 % de la largeur, 11,42 à 42,1 %. Moins d'un niveau de
                luminance, mais sur un aplat quasi noir l'œil lit une couture
                verticale sur toute la hauteur du héros.
                Un voile ne peut pas la supprimer — il faudrait qu'il soit
                opaque à 100 % pile au bord, ce qui effacerait l'image. Le
                masque, lui, met l'alpha de l'image à zéro sur son propre bord :
                plus d'arête, quelle que soit l'image. */}
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

      {/* Half the nav was reachable only from the nav itself. No extra fetch
          here: every number below is already loaded for the section above. */}
      <section className="mx-auto max-w-6xl px-4 pb-10 sm:px-6 sm:pb-14">
        <h2 className="font-display text-h1 font-semibold text-primary">Explore</h2>
        <p className="mt-1 text-small text-muted">Every tier list, ranked the same way.</p>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {EXPLORE.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group flex flex-col rounded-xl border border-subtle bg-raised/40 p-4 transition-colors hover:border-default hover:bg-overlay"
            >
              <span className="font-display text-h2 font-semibold text-primary">{card.title}</span>
              <span className="mt-1 text-small text-muted">{card.blurb}</span>
              <span className="mt-3 text-small text-accent">
                Open <span className="inline-block transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
