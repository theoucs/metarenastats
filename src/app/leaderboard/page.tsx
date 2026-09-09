import { getLeaderboardStats } from "@/lib/aggregate";
import { StatsTable, SampleSizeBadge, type StatsRow } from "@/components/StatsTable";

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
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Player Leaderboard</h1>
      <p className="mt-2 text-zinc-400">
        Ranked by % Top 3 among tracked EUW players. This is a provisional ranking — the
        methodology will evolve as we track more games (see{" "}
        <a href="/info" className="text-blue-400 hover:underline">
          Info &amp; Tips
        </a>
        ).
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        Only players who have been searched on this site (or played with someone who was) appear
        here — this grows over time, it&apos;s not the full EUW player base.
      </p>
      <div className="mt-4 mb-6">
        <SampleSizeBadge totalMatches={totalMatches} />
      </div>
      <StatsTable rows={rows} variant="ranked" />
    </div>
  );
}
