import { notFound } from "next/navigation";
import {
  getChampionStats,
  SHARDBLADE_ITEM_ID,
  type ChampionAugmentStat,
  type ChampionItemSlot,
  type ChampionItemSlotStat,
  type Stat,
} from "@/lib/aggregate";
import { resolveChampion, resolveItem, resolveAugment, heroSplashUrl } from "@/lib/gameData";
import { readChampionDetailSnapshot, readSnapshot } from "@/lib/statsSnapshot";
import { getPatchContext } from "@/lib/patches";
import {
  EntityIcon,
  top1Color,
  top3Color,
  avgPlacementColor,
  StatPill,
  MiniStat,
  MiniStatHeader,
} from "@/lib/statsDisplay";
import { EntityTooltip } from "@/components/EntityTooltip";
import { TieredStatsTabs } from "@/components/TieredStatsTabs";
import { TierBadge, type StatsRow } from "@/components/StatsTable";
import { computeTiers } from "@/lib/tiers";
import { comboToRow } from "@/lib/comboDisplay";

const COMBO_TABS = [
  { key: "item-item", label: "Item + Item" },
  { key: "item-augment", label: "Item + Augment" },
  { key: "augment-augment", label: "Augment + Augment" },
] as const;

// Une page par champion, servie depuis son propre snapshot (clé `champion:<id>`)
// écrit par le job de rafraîchissement — voir lib/statsSnapshot.ts.
export const revalidate = 1800;

/** Les chiffres d'une entité, sous son nom et sa description dans l'infobulle —
 *  le nom est rendu par EntityTooltip, il ne doit pas être répété ici. */
function StatTooltipContent({ stat }: { stat: Stat }) {
  return (
    <div className="text-left">
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-micro text-secondary">
        <span>Avg: {stat.avgPlacement.toFixed(2)}</span>
        <span>Games: {stat.games}</span>
        <span>Top 1: {(stat.top1Rate * 100).toFixed(0)}%</span>
        <span>Top 3: {(stat.top3Rate * 100).toFixed(0)}%</span>
        <span>Played: {(stat.playRate * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

function AugmentCard({ stat }: { stat: ChampionAugmentStat }) {
  const info = resolveAugment(stat.augmentId);
  if (!info) return null;
  return (
    <div className="rounded-lg border border-subtle bg-raised/40 p-3">
      <div className="flex items-center gap-2.5">
        <EntityTooltip entity={{ type: "augment", id: stat.augmentId }} name={info.name}>
          <EntityIcon iconUrl={info.iconUrl} rarity={info.tier as "silver" | "gold" | "prismatic"} />
        </EntityTooltip>
        <span className="min-w-0 flex-1 truncate text-body font-medium text-primary">{info.name}</span>
      </div>
      <div className="mt-2.5 grid grid-cols-5 gap-1 text-center">
        <MiniStat value={stat.avgPlacement.toFixed(2)} colorClass={avgPlacementColor(stat.avgPlacement)} />
        <MiniStat value={`${(stat.top1Rate * 100).toFixed(0)}%`} colorClass={top1Color(stat.top1Rate)} />
        <MiniStat value={`${(stat.top3Rate * 100).toFixed(0)}%`} colorClass={top3Color(stat.top3Rate)} />
        <MiniStat value={String(stat.games)} />
        <MiniStat value={`${(stat.playRate * 100).toFixed(0)}%`} />
      </div>
    </div>
  );
}

function AugmentColumn({ title, stats }: { title: string; stats: ChampionAugmentStat[] }) {
  return (
    <div>
      <h3 className="mb-2 text-small font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {stats.length > 0 && <MiniStatHeader />}
      <div className="mt-1.5 flex flex-col gap-2">
        {stats.length === 0 ? (
          <p className="rounded-lg border border-subtle bg-raised/20 p-3 text-small text-muted">
            No data yet.
          </p>
        ) : (
          stats.map((s) => <AugmentCard key={s.augmentId} stat={s} />)
        )}
      </div>
    </div>
  );
}

function ShardbladeRateBlock({ rate }: { rate: number }) {
  const info = resolveItem(SHARDBLADE_ITEM_ID);
  return (
    <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-subtle bg-inset/40 p-2">
      {info && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={info.iconUrl}
          alt=""
          className="h-9 w-9 shrink-0 rounded-md border border-subtle object-cover"
        />
      )}
      <div className="min-w-0">
        <div className="text-micro text-muted">Shardblade obtained</div>
        <div className="truncate font-mono text-small font-medium text-primary">
          {(rate * 100).toFixed(0)}% of anvil games
        </div>
      </div>
    </div>
  );
}

function PrismaticItemCard({ stat }: { stat: ChampionItemSlotStat }) {
  const info = resolveItem(stat.itemId);
  if (!info) return null;
  return (
    <div className="rounded-lg border border-subtle bg-raised/40 p-3">
      <div className="flex items-center gap-2.5">
        <EntityTooltip entity={{ type: "item", id: stat.itemId }} name={info.name}>
          <EntityIcon iconUrl={info.iconUrl} rarity="prismatic" />
        </EntityTooltip>
        <span className="min-w-0 flex-1 truncate text-body font-medium text-primary">{info.name}</span>
      </div>
      <div className="mt-2.5 grid grid-cols-5 gap-1 text-center">
        <MiniStat value={stat.avgPlacement.toFixed(2)} colorClass={avgPlacementColor(stat.avgPlacement)} />
        <MiniStat value={`${(stat.top1Rate * 100).toFixed(0)}%`} colorClass={top1Color(stat.top1Rate)} />
        <MiniStat value={`${(stat.top3Rate * 100).toFixed(0)}%`} colorClass={top3Color(stat.top3Rate)} />
        <MiniStat value={String(stat.games)} />
        <MiniStat value={`${(stat.playRate * 100).toFixed(0)}%`} />
      </div>
    </div>
  );
}

// Sits beside Item Build in a 2-column layout — full-height sidebar panel
// rather than a small header-row card, so it no longer leaves a hole under
// itself when Item Build's slots take up more vertical space.
function AnvilRunPanel({
  stat,
  shardbladeRate,
  topPrismaticItems,
}: {
  stat: Stat;
  shardbladeRate: number;
  topPrismaticItems: ChampionItemSlotStat[];
}) {
  return (
    <div>
      <h2 className="font-display text-h2 font-semibold text-primary">Anvil Run</h2>
      <p className="mt-0.5 text-small text-secondary">Stat anvils only, no items bought.</p>

      <div className="mt-2">
        <MiniStatHeader />
        <div className="mt-1 grid grid-cols-5 gap-1 px-3 text-center">
          <MiniStat value={stat.avgPlacement.toFixed(2)} colorClass={avgPlacementColor(stat.avgPlacement)} />
          <MiniStat value={`${(stat.top1Rate * 100).toFixed(0)}%`} colorClass={top1Color(stat.top1Rate)} />
          <MiniStat value={`${(stat.top3Rate * 100).toFixed(0)}%`} colorClass={top3Color(stat.top3Rate)} />
          <MiniStat value={String(stat.games)} />
          <MiniStat value={`${(stat.playRate * 100).toFixed(0)}%`} />
        </div>
      </div>

      <ShardbladeRateBlock rate={shardbladeRate} />

      <div className="mt-3">
        <h3 className="mb-1.5 text-small font-semibold uppercase tracking-wide text-muted">
          Top Prismatic Items
        </h3>
        {topPrismaticItems.length > 0 && <MiniStatHeader />}
        <div className="mt-1.5 flex flex-col gap-1.5">
          {topPrismaticItems.length === 0 ? (
            <p className="rounded-lg border border-subtle bg-raised/20 p-3 text-small text-muted">
              No data yet.
            </p>
          ) : (
            topPrismaticItems.map((s) => <PrismaticItemCard key={s.itemId} stat={s} />)
          )}
        </div>
      </div>
    </div>
  );
}

function ItemSlotBlock({ slot }: { slot: ChampionItemSlot }) {
  const [primary, ...alts] = slot.items;
  const primaryInfo = primary ? resolveItem(primary.itemId) : undefined;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-micro font-semibold uppercase tracking-wide text-muted">Slot {slot.slot}</div>

      {primaryInfo && primary && (
        <>
          <EntityTooltip
            entity={{ type: "item", id: primary.itemId }}
            name={primaryInfo.name}
            extra={<StatTooltipContent stat={primary} />}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={primaryInfo.iconUrl}
              alt=""
              className="h-16 w-16 rounded-lg border border-subtle object-cover"
            />
          </EntityTooltip>
          <div className="font-mono text-micro text-secondary">{(primary.playRate * 100).toFixed(0)}%</div>
        </>
      )}

      {alts.length > 0 && (
        <div className="flex gap-1.5">
          {alts.map((alt) => {
            const info = resolveItem(alt.itemId);
            if (!info) return null;
            return (
              <EntityTooltip
                key={alt.itemId}
                entity={{ type: "item", id: alt.itemId }}
                name={info.name}
                extra={<StatTooltipContent stat={alt} />}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={info.iconUrl}
                  alt=""
                  className="h-[30px] w-[30px] rounded border border-subtle object-cover"
                />
              </EntityTooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default async function ChampionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const champInfo = resolveChampion(slug);
  if (!champInfo) notFound();

  // Site-wide champion stats come along for the ride so the header can say
  // where this champion actually sits — a tier badge and "#7 of 173" is the
  // one thing a build page header can tell you that the numbers below can't.
  const patch = await getPatchContext();
  const [detail, { champions }] = await Promise.all([
    readChampionDetailSnapshot(slug.toLowerCase(), patch.defaultPatch),
    readSnapshot("champions", getChampionStats, patch.defaultPatch),
  ]);

  const rank = (() => {
    const rows = champions.map((c) => ({
      key: resolveChampion(c.champion)?.id ?? c.champion,
      games: c.games,
      top3Rate: c.top3Rate,
      top1Rate: c.top1Rate,
      avgPlacement: c.avgPlacement,
    }));
    const tierMap = computeTiers(rows);
    if (!tierMap.has(champInfo.id)) return null;
    const ordered = [...rows].sort((a, b) => tierMap.get(b.key)!.score - tierMap.get(a.key)!.score);
    return {
      position: ordered.findIndex((r) => r.key === champInfo.id) + 1,
      total: ordered.length,
      tier: tierMap.get(champInfo.id)!.tier,
    };
  })();

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
    <div>
      {/* Taller by the same 24px the name block gained in bottom padding, so
          the extra breathing room comes out of the banner rather than pushing
          the name up off the scrim's solid zone and onto the splash art. */}
      <div className="relative h-[264px] w-full overflow-hidden bg-raised sm:h-[324px]">
        {/* `centered` (1280x720), not `loading` (308x560): the loading art is a
            portrait crop that had to be upscaled ~4.7x to span a wide banner,
            which is what turned this header into a grey smear. The centered
            splash is already landscape and near 1:1 at this size. object-top
            would cut foreheads on a 720px-tall source, so bias just below
            center where splash art puts the face. Uses the champion's most
            popular skin (same pick as the homepage hero) rather than the base
            splash — the base splash next to the base square icon just below
            is the same art twice. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={heroSplashUrl(champInfo.id)}
          alt=""
          width={1280}
          height={720}
          className="absolute inset-0 h-full w-full object-cover object-[center_28%]"
        />
        {/* Two scrims, each doing one job. Vertical: from-15% keeps the art
            visible almost to the bottom edge — the pills that overlap it are
            translucent-with-blur by design now, so the splash showing through
            between them is the effect, not a bug. Horizontal: keeps the name
            legible over whatever the art happens to be doing on the left, while
            leaving the right side of the splash actually visible. */}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base)] from-15% via-[var(--bg-base)]/55 via-55% to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-base)]/90 via-[var(--bg-base)]/30 via-45% to-transparent" />
        {/* The name now sits *on* the art rather than on the solid strip the old
            scrim guaranteed below it. The pills overlap the banner by 48px
            (-mt-12), so the padding here has to clear that overlap *plus* a
            real gap: at pb-8 the pills sat straight on top of "Rank #1 of 173".
            80 - 48 = 32px of visible air under the name. */}
        <div className="relative mx-auto flex h-full max-w-6xl items-end px-4 pb-20 sm:px-6">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={champInfo.iconUrl}
              alt=""
              className="h-16 w-16 rounded-xl border border-strong object-cover shadow-[var(--elev-3)]"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className="font-display text-display font-semibold tracking-tight text-primary drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                  {champInfo.name}
                </h1>
                {rank && <TierBadge tier={rank.tier} />}
              </div>
              <p className="text-small text-secondary">
                {rank ? (
                  <>
                    Rank <span className="font-mono tabular-nums text-primary">#{rank.position}</span>{" "}
                    of {rank.total} champions
                  </>
                ) : (
                  "Arena build summary"
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6 sm:pb-12">
        {/* relative + z-10: the banner above is `position: relative` (for its
            absolute img/scrim children) — CSS paints positioned elements above
            non-positioned siblings regardless of DOM order, so without this,
            the banner silently wins the overlap and swallows whatever pokes
            up into it (e.g. the stat pill labels, which sit higher in each
            pill than the value). Making this positioned too puts DOM order
            back in charge, and it comes after the banner in the DOM. */}
        <div className="relative z-10 -mt-12">
          {!detail ? (
            <div className="rounded-lg border border-subtle bg-raised/40 p-10 text-center text-secondary">
              No data yet for {champInfo.name}. Search a player who played this champion to start
              populating stats.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 [&>*:first-child]:col-span-2 sm:grid-cols-5 sm:[&>*:first-child]:col-span-1">
                <StatPill
                  label="Avg Placement"
                  value={detail.avgPlacement.toFixed(2)}
                  colorClass={avgPlacementColor(detail.avgPlacement)}
                  emphasis
                />
                <StatPill
                  label="% Top 1"
                  value={`${(detail.top1Rate * 100).toFixed(1)}%`}
                  colorClass={top1Color(detail.top1Rate)}
                />
                <StatPill
                  label="% Top 3"
                  value={`${(detail.top3Rate * 100).toFixed(1)}%`}
                  colorClass={top3Color(detail.top3Rate)}
                />
                <StatPill label="Games" value={String(detail.games)} />
                <StatPill label="% Played" value={`${(detail.playRate * 100).toFixed(1)}%`} />
              </div>

              <section className="mt-10 border-t border-subtle pt-8">
                <h2 className="font-display text-h2 font-semibold text-primary">Best Augments</h2>
                <p className="mt-1 text-small text-secondary">Among this champion&apos;s own games.</p>
                <div className="mt-4 grid gap-4 sm:gap-6 md:grid-cols-3">
                  <AugmentColumn title="Silver" stats={detail.augmentsByRarity.silver} />
                  <AugmentColumn title="Gold" stats={detail.augmentsByRarity.gold} />
                  <AugmentColumn title="Prismatic" stats={detail.augmentsByRarity.prismatic} />
                </div>
              </section>

              <section className="mt-10 border-t border-subtle pt-8">
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div>
                    <h2 className="font-display text-h2 font-semibold text-primary">Item Build</h2>
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
                    />
                  )}
                </div>
              </section>

              <section className="mt-10 border-t border-subtle pt-8">
                <h2 className="font-display text-h2 font-semibold text-primary">Top Combos</h2>
                <p className="mt-1 text-small text-secondary">
                  Best-performing pairs on this champion specifically.
                </p>
                <div className="mt-4">
                  <TieredStatsTabs
                    tabs={COMBO_TABS}
                    rowsByTier={comboRowsByTier}
                    defaultTab="item-augment"
                  />
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
