import Link from "next/link";
import { getLeaderboardStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { PageHeader } from "@/components/PageHeader";

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
    games: p.games,
    top3Rate: p.top3Rate,
    top1Rate: p.top1Rate,
    avgPlacement: p.avgPlacement,
    playRate: p.playRate,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader
        eyebrow="Rankings"
        title="Player Leaderboard"
        totalMatches={totalMatches}
        description={
          <>
            Ranked by Arena MMR — a rating that moves with every game, weighing who you were up
            against and who you had with you. Iron to Challenger, like ranked (
            <Link href="/info" className="text-accent hover:underline">
              how it works
            </Link>
            ).
          </>
        }
      >
        <p className="mt-1 text-small text-muted">
          Showing the top <span className="text-secondary">{players.length}</span> of{" "}
          <span className="text-secondary">{totalRanked}</span> ranked players. Below that, search
          a player to see their exact rank. Minimum 5 tracked games, and only players searched on
          this site (or who played with someone who was) are ranked at all.
        </p>
      </PageHeader>
      <StatsTable filterPlaceholder="Search a player" rows={rows} variant="ranked" />
    </div>
  );
}
