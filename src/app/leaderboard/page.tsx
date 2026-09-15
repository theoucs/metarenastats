import Link from "next/link";
import { getLeaderboardStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { PageHeader } from "@/components/PageHeader";
import { HeadlineRow, HeaderAside } from "@/components/HeadlineRow";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

export default async function LeaderboardPage() {
  const { totalMatches, players, totalRanked } = await readSnapshot(
    "leaderboard",
    getLeaderboardStats,
  );

  const rows: StatsRow[] = players.map((p) => ({
    key: p.puuid,
    name: p.riotId,
    rankTier: (p.tier as StatsRow["rankTier"]) ?? undefined,
    rank: p.position ?? undefined,
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
          <HeaderAside label="Scope">
            <span className="rounded-lg border border-subtle bg-inset px-3 py-1.5 text-small font-medium text-primary">
              All patches
            </span>
            <span className="text-small text-muted">
              <span className="tabular-nums text-secondary">{totalMatches}</span> matches tracked
            </span>
          </HeaderAside>
        }
      >
        <PageHeader
          eyebrow="Rankings"
          title="Player Leaderboard"
          description={
            <>
              Ranked by Arena MMR — it moves with every game, weighted by who you faced and who you
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
            <span className="tabular-nums text-secondary">{totalRanked}</span> ranked. Search any
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
