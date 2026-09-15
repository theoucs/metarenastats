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
  const { totalMatches, players } = await readSnapshot("leaderboard", getLeaderboardStats);

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
          Minimum 5 tracked games. Only players who have been searched on this site (or played
          with someone who was) appear here — this grows over time, it&apos;s not the full EUW
          player base.
        </p>
      </PageHeader>
      <StatsTable filterPlaceholder="Search a player" rows={rows} variant="ranked" />
    </div>
  );
}
