import { getAnvilChampionStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { PageHeader } from "@/components/PageHeader";
import { PatchSwitch } from "@/components/PatchSwitch";
import { getPatchContext } from "@/lib/patches";
import { resolveChampion, itemCategory } from "@/lib/gameData";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

function toRows(champions: Awaited<ReturnType<typeof getAnvilChampionStats>>["champions"]): StatsRow[] {
  return champions.map((c) => {
    const info = resolveChampion(c.champion);
    return {
      key: info?.id ?? c.champion,
      name: info?.name ?? c.champion,
      iconUrl: info?.iconUrl,
      games: c.games,
      top3Rate: c.top3Rate,
      top1Rate: c.top1Rate,
      avgPlacement: c.avgPlacement,
      playRate: c.playRate,
    };
  });
}

export default async function AnvilPage() {
  const patch = await getPatchContext();

  const views = Object.fromEntries(
    await Promise.all(
      patch.options.map(async (option) => {
        const { champions } = await readSnapshot(
          "anvil",
          () => getAnvilChampionStats(itemCategory),
          option.patch,
        );
        return [
          option.patch,
          <StatsTable
            key={option.patch}
            rows={toRows(champions)}
            linkPrefix="/champions/"
            linkSuffix={option.patch === patch.defaultPatch ? undefined : `?patch=${option.patch}`}
            playRateLabel="% Anvil Run"
            filterPlaceholder="Search a champion"
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
          title="Anvil Run"
          isNew
          description="Champions played on a full anvil run — stat anvils only, no items bought."
        />
      </PatchSwitch>
    </div>
  );
}
