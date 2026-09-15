import Link from "next/link";
import { getCompStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { type StatsRow } from "@/components/StatsTable";
import { TieredStatsTabs, type StatsTab } from "@/components/TieredStatsTabs";
import { PageHeader } from "@/components/PageHeader";
import { PatchSwitch } from "@/components/PatchSwitch";
import { getPatchContext } from "@/lib/patches";
import { ShowMoreNote } from "@/components/ShowMoreNote";
import { championRole } from "@/lib/gameData";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

// Duos and trios are the same tier list at finer grain, both blocked on sample
// size rather than on anything technical — listed here so the page says what
// it will become instead of silently omitting it.
const TABS: StatsTab[] = [
  { key: "archetypes", label: "Archetypes" },
  { key: "duos", label: "Champion Duos", comingSoon: true },
  { key: "trios", label: "Champion Trios", comingSoon: true },
];

export default async function CompsPage() {
  const patch = await getPatchContext();

  const views = Object.fromEntries(
    await Promise.all(
      patch.options.map(async (option) => {
        const { archetypes } = await readSnapshot(
          "comps",
          () => getCompStats(championRole),
          option.patch,
        );

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

        return [
          option.patch,
          /* gamesBonus off — voir la note de l'en-tête et TierOptions. */
          <TieredStatsTabs
            key={option.patch}
            filterPlaceholder="Search a role"
            tabs={TABS}
            rowsByTier={{ archetypes: rows }}
            display="grid"
            playRateLabel="% of Teams"
            unitLabel="teams"
            gamesBonus={false}
          />,
        ] as const;
      }),
    ),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <PatchSwitch context={patch} views={views}>
        <PageHeader
          eyebrow="Tier list"
          title="Team Comps"
          description="Three-champion shapes, measured on every team in every match — not just the one you were on. Needs 20 teams."
        >
          <ShowMoreNote label="Why shapes, and not champion names">
            <p className="max-w-2xl text-small text-muted">
              Naming specific champions doesn&apos;t work yet: nearly every three-champion
              combination has been seen exactly once, and few pairings clear 8 games. Both tabs
              unlock when the sample supports them — ranking either one today would be noise with a
              tier badge on it.
            </p>
            <p className="mt-1.5 max-w-2xl text-small text-muted">
              Tiers here ignore how often a shape turns up: with 50 of 173 champions classed as
              Fighters, that would measure the roster, not the comp.{" "}
              <Link href="/info" className="text-accent hover:underline">
                How tiers are calculated
              </Link>
              .
            </p>
          </ShowMoreNote>
        </PageHeader>
      </PatchSwitch>
    </div>
  );
}
