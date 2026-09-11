import Link from "next/link";
import { getCompStats } from "@/lib/aggregate";
import { type StatsRow } from "@/components/StatsTable";
import { StatsGrid } from "@/components/StatsGrid";
import { PageHeader } from "@/components/PageHeader";
import { championRole } from "@/lib/gameData";

export const dynamic = "force-dynamic";

const n = (value: number) => value.toLocaleString("en-US");

export default async function CompsPage() {
  const { totalMatches, totalTeams, archetypes, coverage } = await getCompStats(championRole);

  const rows: StatsRow[] = archetypes.map((a) => ({
    key: a.roles.join("-"),
    name: a.roles.join(" · "),
    roles: a.roles,
    games: a.games,
    top3Rate: a.top3Rate,
    top1Rate: a.top1Rate,
    avgPlacement: a.avgPlacement,
    playRate: a.playRate,
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader
        eyebrow="Tier list"
        title="Team Comps"
        isNew
        description="Which three-champion team shapes actually place — measured across every team in every tracked match, not just the one you were on."
        totalMatches={totalMatches}
      >
        <p className="mt-3 max-w-2xl text-small text-muted">
          Comps are grouped by champion class, because naming specific champions doesn&apos;t work
          yet: across <span className="text-secondary">{n(totalTeams)}</span> tracked teams there are{" "}
          <span className="text-secondary">{n(coverage.trios.distinct)}</span> distinct trios, and
          only <span className="text-secondary">{n(coverage.trios.repeated)}</span> have been seen
          more than once. Specific duos aren&apos;t much better —{" "}
          <span className="text-secondary">{n(coverage.duos.usable)}</span> of{" "}
          <span className="text-secondary">{n(coverage.duos.distinct)}</span> pairings clear 8 games.
          Both get their own tier list once the sample supports one; ranking them today would be
          noise with a tier badge on it.
        </p>
        <p className="mt-1.5 max-w-2xl text-small text-muted">
          A comp needs 20 teams to be listed. Tiers here ignore how often a shape turns up — with 50
          of 173 champions classed as Fighters, that measures the roster, not the comp.{" "}
          <Link href="/info" className="text-accent hover:underline">
            How tiers are calculated
          </Link>
          .
        </p>
      </PageHeader>

      {/* gamesBonus off — see the note above and TierOptions. */}
      <StatsGrid rows={rows} playRateLabel="% of Teams" unitLabel="teams" gamesBonus={false} />
    </div>
  );
}
