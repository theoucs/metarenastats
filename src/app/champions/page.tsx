import { getChampionStats } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { PageHeader } from "@/components/PageHeader";
import { PatchSwitch } from "@/components/PatchSwitch";
import { getPatchContext } from "@/lib/patches";
import { resolveChampion } from "@/lib/gameData";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

function toRows(champions: Awaited<ReturnType<typeof getChampionStats>>["champions"]): StatsRow[] {
  return champions.map((c) => {
    const info = resolveChampion(c.champion);
    return {
      // Use Data Dragon's canonical casing as the key so search-result anchor
      // links (which are built from the same reference data) land on the
      // right row — falls back to the raw value if we don't recognize it.
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

export default async function ChampionsPage() {
  const patch = await getPatchContext();

  // Les deux patchs sont rendus ici, côté serveur, et `PatchSwitch` n'en affiche
  // qu'un : la bascule ne coûte aucune requête et la page reste statique.
  const views = Object.fromEntries(
    await Promise.all(
      patch.options.map(async (option) => {
        const { champions } = await readSnapshot("champions", getChampionStats, option.patch);
        return [
          option.patch,
          <StatsTable
            key={option.patch}
            rows={toRows(champions)}
            linkPrefix="/champions/"
            linkSuffix={option.patch === patch.defaultPatch ? undefined : `?patch=${option.patch}`}
          />,
        ] as const;
      }),
    ),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader
        eyebrow="Tier list"
        title="Champions"
        description="Click a champion for its full build page."
      />
      <PatchSwitch context={patch} views={views} />
    </div>
  );
}
