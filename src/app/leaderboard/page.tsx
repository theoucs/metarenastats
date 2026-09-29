import Link from "next/link";
import { formatCount } from "@/lib/statsDisplay";
import { getLeaderboardStats, getSiteStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { resolveChampion } from "@/lib/gameData";
import { PageHeader } from "@/components/PageHeader";
import { HeadlineRow, HeaderAside } from "@/components/HeadlineRow";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

export default async function LeaderboardPage() {
  // The match count comes from the same "site" snapshot as the home page. The
  // leaderboard snapshot carries its own copy, taken at its own refresh, and
  // the two pages showed 126,814 and 126,094 for the same thing.
  const [{ players, totalRanked }, { totalMatches }] = await Promise.all([
    readSnapshot("leaderboard", getLeaderboardStats),
    readSnapshot("site", getSiteStats),
  ]);

  const rows: StatsRow[] = players.map((p) => ({
    key: p.puuid,
    name: p.riotId,
    rankTier: (p.tier as StatsRow["rankTier"]) ?? undefined,
    rank: p.position ?? undefined,
    mmr: p.mmr,
    teammateMmr: p.teammateMmr ?? undefined,
    opponentMmr: p.opponentMmr ?? undefined,
    champions: (p.topChampions ?? []).map((name) => {
      const info = resolveChampion(name);
      return { id: info?.id ?? name, name: info?.name ?? name, iconUrl: info?.iconUrl };
    }),
    href: `/players/${encodeURIComponent(p.riotId)}`,
    games: p.games,
    top3Rate: p.top3Rate,
    top1Rate: p.top1Rate,
    avgPlacement: p.avgPlacement,
    playRate: p.playRate,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <HeadlineRow
        aside={
          <HeaderAside>
            {/* Plain text, not a pill: the pill looked like a button that did
                nothing. */}
            <span className="text-small text-muted">
              All patches ·{" "}
              <span className="tabular-nums text-secondary">{formatCount(totalMatches)}</span> matches
            </span>
          </HeaderAside>
        }
      >
        <PageHeader
          title="Player Leaderboard"
          description={
            <>
              Ranked by Arena MMR. It moves with every game, weighted by who you faced and who you
              played with (
              <Link href="/info" className="text-accent hover:underline">
                how it works
              </Link>
              ).
            </>
          }
        >
          <p className="mt-2 text-small text-muted">
            Top <span className="tabular-nums text-secondary">{players.length}</span> of{" "}
            <span className="tabular-nums text-secondary">{formatCount(totalRanked)}</span> ranked. Search any
            player to see their exact rank, wherever they sit.
          </p>
        </PageHeader>
      </HeadlineRow>
      <StatsTable
        filterPlaceholder="Search a player"
        searchBeyondUrl="/api/leaderboard/search"
        rows={rows}
        variant="ranked"
      />
    </div>
  );
}
