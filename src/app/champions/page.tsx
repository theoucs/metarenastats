import { getChampionMovers, getChampionStats } from "@/lib/aggregate";
import { readMoversSnapshot, readSnapshot } from "@/lib/statsSnapshot";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { PageHeader } from "@/components/PageHeader";
import { PatchSwitch } from "@/components/PatchSwitch";
import { getPatchContext } from "@/lib/patches";
import { resolveChampion } from "@/lib/gameData";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

function toRows(
  champions: Awaited<ReturnType<typeof getChampionStats>>["champions"],
  movers: Awaited<ReturnType<typeof getChampionMovers>>,
): StatsRow[] {
  const moved = new Map(movers.movers.map((m) => [m.champion, m]));
  return champions.map((c) => {
    const info = resolveChampion(c.champion);
    const mover = moved.get(c.champion);
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
      // Absent from snapshots written before the distribution existed.
      placements: c.placements,
      mover: mover
        ? { previousAvgPlacement: mover.previousAvgPlacement, previousPatch: movers.previousPatch }
        : undefined,
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
        const [{ champions }, movers] = await Promise.all([
          readSnapshot("champions", getChampionStats, option.patch),
          readMoversSnapshot(option.patch),
        ]);
        return [
          option.patch,
          <StatsTable
            filterPlaceholder="Search a champion"
            key={option.patch}
            rows={toRows(champions, movers)}
            linkPrefix="/champions/"
            linkSuffix={option.patch === patch.defaultPatch ? undefined : `?patch=${option.patch}`}
          />,
        ] as const;
      }),
    ),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <PatchSwitch context={patch} views={views}>
        <PageHeader title="Champions" />
      </PatchSwitch>
    </div>
  );
}
