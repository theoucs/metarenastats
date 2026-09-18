import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { type StatsRow } from "@/components/StatsTable";
import { comboToRow } from "@/lib/comboDisplay";
import { MiniStatHeader } from "@/lib/statsDisplay";
import { loadChampionPage, ChampionShell } from "./championPage";
import {
  AugmentColumn,
  AnvilRunPanel,
  ItemSlotBlock,
  PrismaticItemCard,
  SeeAllLink,
} from "./championSections";

const COMBO_TABS = [
  { key: "item-item", label: "Item + Item" },
  { key: "item-augment", label: "Item + Augment" },
  { key: "augment-augment", label: "Augment + Augment" },
] as const;

// Une page par champion, servie depuis son propre snapshot (clé `champion:<id>`)
// écrit par le job de rafraîchissement — voir lib/statsSnapshot.ts.
export const revalidate = 1800;

/** Le titre d'une section du résumé, avec son lien vers l'onglet complet. */
function SectionHeading({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-h2 font-semibold text-primary">{title}</h2>
        <SeeAllLink href={href}>See all</SeeAllLink>
      </div>
      {children && <p className="mt-1 text-small text-secondary">{children}</p>}
    </>
  );
}

export default async function ChampionSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ patch?: string }>;
}) {
  const data = await loadChampionPage(params, searchParams);
  const { detail, slug, patchParam } = data;
  const query = patchParam ? `?patch=${encodeURIComponent(patchParam)}` : "";
  const tab = (name: string) => `/champions/${slug}/${name}${query}`;

  const comboRowsByTier: Record<string, StatsRow[]> = {
    "item-item": [],
    "item-augment": [],
    "augment-augment": [],
  };
  if (detail) {
    for (const [category, combos] of Object.entries(detail.championCombos)) {
      comboRowsByTier[category] = combos.map(comboToRow);
    }
  }

  return (
    <ChampionShell data={data} active="summary">
      {detail && (
        <>
          <section className="mt-10 border-t border-subtle pt-8">
            <SectionHeading title="Best Augments" href={tab("augments")}>
              Among this champion&apos;s own games.
            </SectionHeading>
            <div className="mt-4 grid gap-4 sm:gap-6 md:grid-cols-3">
              <AugmentColumn title="Silver" stats={detail.augmentsByRarity.silver} />
              <AugmentColumn title="Gold" stats={detail.augmentsByRarity.gold} />
              <AugmentColumn title="Prismatic" stats={detail.augmentsByRarity.prismatic} />
            </div>
          </section>

          <section className="mt-10 border-t border-subtle pt-8">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <SectionHeading title="Item Build" href={tab("items")} />
                {detail.itemBuild.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-subtle bg-raised/20 p-3 text-small text-muted">
                    No item data yet.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-4 sm:gap-6">
                    {detail.itemBuild.map((slot) => (
                      <ItemSlotBlock key={slot.slot} slot={slot} />
                    ))}
                  </div>
                )}

                <div className="mt-6">
                  <h3 className="mb-2 text-small font-semibold uppercase tracking-wide text-muted">
                    Top Prismatic Items
                  </h3>
                  {detail.topPrismaticItems.length > 0 && <MiniStatHeader />}
                  {/* Single column, unlike before: the five stat labels are
                      now written once above the list, and a 2-up grid would
                      leave that header spanning both columns while the
                      values sat under only the first. */}
                  <div className="mt-1.5 grid gap-2">
                    {detail.topPrismaticItems.length === 0 ? (
                      <p className="rounded-lg border border-subtle bg-raised/20 p-3 text-small text-muted">
                        No data yet.
                      </p>
                    ) : (
                      detail.topPrismaticItems.map((s) => (
                        <PrismaticItemCard key={s.itemId} stat={s} />
                      ))
                    )}
                  </div>
                </div>
              </div>
              {detail.anvilStat.games > 0 && (
                <AnvilRunPanel
                  stat={detail.anvilStat}
                  shardbladeRate={detail.anvilShardbladeRate}
                  topPrismaticItems={detail.anvilTopPrismaticItems}
                  seeAllHref={tab("anvil")}
                />
              )}
            </div>
          </section>

          <section className="mt-10 border-t border-subtle pt-8">
            <SectionHeading title="Top Combos" href={tab("combos")}>
              Best-performing pairs on this champion specifically.
            </SectionHeading>
            <div className="mt-4">
              <TieredStatsTabs
                tabs={COMBO_TABS}
                rowsByTier={comboRowsByTier}
                defaultTab="item-augment"
                filterPlaceholder="Search an item or augment"
              />
            </div>
          </section>
        </>
      )}
    </ChampionShell>
  );
}
