import { getAnvilChampionStats, type Stat } from "@/lib/aggregate";
import { readSnapshot } from "@/lib/statsSnapshot";
import { type StatsRow } from "@/components/StatsTable";
import { AnvilOpenerSwitch, type OpenerOption } from "@/components/AnvilOpenerSwitch";
import { PageHeader } from "@/components/PageHeader";
import { PatchSwitch } from "@/components/PatchSwitch";
import { getPatchContext } from "@/lib/patches";
import { resolveChampion, resolveAugment, itemCategory } from "@/lib/gameData";
import type { EntityRarity } from "@/lib/statsDisplay";

// Stats servies depuis un snapshot pré-calculé (lib/statsSnapshot.ts) : la page
// est mise en cache et régénérée périodiquement au lieu d'agréger toute la base
// à chaque visite.
export const revalidate = 1800;

type AnvilStats = Awaited<ReturnType<typeof getAnvilChampionStats>>;

function toRows(champions: ({ champion: string } & Stat)[]): StatsRow[] {
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

/** Ce qu'on affiche quand le snapshot ne porte pas encore d'ouvertures — voir
 *  `openersOf`. Zéro partie, donc le bandeau ne s'affiche pas du tout. */
const NO_OUTCOME = { games: 0, avgPlacement: 0, top3Rate: 0, top1Rate: 0 };

/**
 * Les ouvertures d'un snapshot, prêtes à l'affichage.
 *
 * Le `?? []` n'est pas de la prudence gratuite : entre le déploiement de cette
 * page et le passage suivant du job de publication (une demi-heure au pire),
 * les snapshots en base sont ceux d'AVANT et n'ont ni `openers` ni `overall`.
 * Même frontière que `withMissingLists` dans lib/statsSnapshot.ts — le type dit
 * ce que le job produit aujourd'hui, et seule la lecture connaît le décalage.
 */
function openersOf(anvil: AnvilStats): OpenerOption[] {
  return (anvil.openers ?? [])
    // Un augment sorti du pool garderait une entrée vide : inutile de proposer
    // un filtre qui ne peut rien montrer.
    .filter((o) => o.anvil.games > 0)
    .map((o) => {
      const info = resolveAugment(o.augmentId);
      return {
        augmentId: o.augmentId,
        name: info?.name ?? `Augment ${o.augmentId}`,
        iconUrl: info?.iconUrl,
        rarity: info?.tier as EntityRarity | undefined,
        anvil: o.anvil,
        bought: o.bought,
        rows: toRows(o.champions),
      };
    });
}

export default async function AnvilPage() {
  const patch = await getPatchContext();

  const views = Object.fromEntries(
    await Promise.all(
      patch.options.map(async (option) => {
        const anvil = await readSnapshot(
          "anvil",
          () => getAnvilChampionStats(itemCategory),
          option.patch,
        );
        return [
          option.patch,
          <AnvilOpenerSwitch
            key={option.patch}
            baseRows={toRows(anvil.champions)}
            baseOutcome={anvil.overall ?? NO_OUTCOME}
            openers={openersOf(anvil)}
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
