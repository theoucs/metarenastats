import Link from "next/link";
import { getLeaderboardStats } from "@/lib/aggregate";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const { totalMatches, players } = await getLeaderboardStats();

  const rows: StatsRow[] = players.map((p) => ({
    key: p.puuid,
    name: p.riotId,
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
            Ranked by % Top 3 among tracked EUW players. This is a provisional ranking — the
            methodology will evolve as we track more games (see{" "}
            <Link href="/info" className="text-accent hover:underline">
              Info &amp; Tips
            </Link>
            ).
          </>
        }
      >
        <p className="mt-1 text-small text-muted">
          Only players who have been searched on this site (or played with someone who was) appear
          here — this grows over time, it&apos;s not the full EUW player base.
        </p>
      </PageHeader>
      <StatsTable rows={rows} variant="ranked" />
    </div>
  );
}
