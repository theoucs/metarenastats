import { notFound } from "next/navigation";
import {
  getChampionDetail,
  SHARDBLADE_ITEM_ID,
  type ChampionAugmentStat,
  type ChampionItemSlot,
  type ChampionItemSlotStat,
  type Stat,
} from "@/lib/aggregate";
import { resolveChampion, resolveItem, resolveAugment, itemCategory } from "@/lib/gameData";
import { EntityIcon, top1Color, top3Color, StatPill, MiniStat } from "@/lib/statsDisplay";
import { Tooltip } from "@/components/Tooltip";

export const dynamic = "force-dynamic";

function StatTooltipContent({ name, stat }: { name: string; stat: Stat }) {
  return (
    <div className="text-left">
      <div className="font-semibold text-zinc-50">{name}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-zinc-300">
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
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center gap-2.5">
        <EntityIcon iconUrl={info.iconUrl} rarity={info.tier as "silver" | "gold" | "prismatic"} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
          {info.name}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-5 gap-1 text-center">
        <MiniStat label="Avg" value={stat.avgPlacement.toFixed(2)} />
        <MiniStat
          label="Top 1"
          value={`${(stat.top1Rate * 100).toFixed(0)}%`}
          colorClass={top1Color(stat.top1Rate)}
        />
        <MiniStat
          label="Top 3"
          value={`${(stat.top3Rate * 100).toFixed(0)}%`}
          colorClass={top3Color(stat.top3Rate)}
        />
        <MiniStat label="Games" value={String(stat.games)} />
        <MiniStat label="Played" value={`${(stat.playRate * 100).toFixed(0)}%`} />
      </div>
    </div>
  );
}

function AugmentColumn({ title, stats }: { title: string; stats: ChampionAugmentStat[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <div className="flex flex-col gap-2">
        {stats.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-3 text-sm text-zinc-600">
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
    <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
      {info && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={info.iconUrl}
          alt=""
          className="h-9 w-9 shrink-0 rounded-md border border-zinc-800 object-cover"
        />
      )}
      <div className="min-w-0">
        <div className="text-[11px] text-zinc-500">Shardblade obtained</div>
        <div className="truncate font-mono text-sm font-medium text-zinc-100">
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
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center gap-2.5">
        <EntityIcon iconUrl={info.iconUrl} rarity="prismatic" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
          {info.name}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-5 gap-1 text-center">
        <MiniStat label="Avg" value={stat.avgPlacement.toFixed(2)} />
        <MiniStat
          label="Top 1"
          value={`${(stat.top1Rate * 100).toFixed(0)}%`}
          colorClass={top1Color(stat.top1Rate)}
        />
        <MiniStat
          label="Top 3"
          value={`${(stat.top3Rate * 100).toFixed(0)}%`}
          colorClass={top3Color(stat.top3Rate)}
        />
        <MiniStat label="Games" value={String(stat.games)} />
        <MiniStat label="Played" value={`${(stat.playRate * 100).toFixed(0)}%`} />
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
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h2 className="text-lg font-semibold text-zinc-100">Anvil Run</h2>
      <p className="mt-0.5 text-sm text-zinc-500">Stat anvils only, no items bought.</p>

      <div className="mt-2 grid grid-cols-5 gap-1 text-center">
        <MiniStat label="Avg" value={stat.avgPlacement.toFixed(2)} />
        <MiniStat
          label="Top 1"
          value={`${(stat.top1Rate * 100).toFixed(0)}%`}
          colorClass={top1Color(stat.top1Rate)}
        />
        <MiniStat
          label="Top 3"
          value={`${(stat.top3Rate * 100).toFixed(0)}%`}
          colorClass={top3Color(stat.top3Rate)}
        />
        <MiniStat label="Games" value={String(stat.games)} />
        <MiniStat label="Played" value={`${(stat.playRate * 100).toFixed(0)}%`} />
      </div>

      <ShardbladeRateBlock rate={shardbladeRate} />

      <div className="mt-3">
        <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Top Prismatic Items
        </h3>
        <div className="flex flex-col gap-1.5">
          {topPrismaticItems.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-3 text-sm text-zinc-600">
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
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Slot {slot.slot}
      </div>

      {primaryInfo && primary && (
        <>
          <Tooltip content={<StatTooltipContent name={primaryInfo.name} stat={primary} />}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={primaryInfo.iconUrl}
              alt=""
              className="h-16 w-16 rounded-lg border border-zinc-800 object-cover"
            />
          </Tooltip>
          <div className="font-mono text-[11px] text-zinc-400">
            {(primary.playRate * 100).toFixed(0)}%
          </div>
        </>
      )}

      {alts.length > 0 && (
        <div className="flex gap-1.5">
          {alts.map((alt) => {
            const info = resolveItem(alt.itemId);
            if (!info) return null;
            return (
              <Tooltip key={alt.itemId} content={<StatTooltipContent name={info.name} stat={alt} />}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={info.iconUrl}
                  alt=""
                  className="h-[30px] w-[30px] rounded border border-zinc-800 object-cover"
                />
              </Tooltip>
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

  const detail = await getChampionDetail(
    slug.toLowerCase(),
    (id) => resolveAugment(id)?.tier as "silver" | "gold" | "prismatic" | undefined,
    itemCategory
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={champInfo.iconUrl}
          alt=""
          className="h-16 w-16 rounded-xl border border-zinc-800 object-cover"
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{champInfo.name}</h1>
          <p className="text-sm text-zinc-500">Arena build summary</p>
        </div>
      </div>

      {!detail ? (
        <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/40 p-10 text-center text-zinc-500">
          No data yet for {champInfo.name}. Search a player who played this champion to start
          populating stats.
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatPill label="Avg Placement" value={detail.avgPlacement.toFixed(2)} />
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

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-zinc-100">Best Augments</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Among this champion&apos;s own games.
            </p>
            <div className="mt-4 grid gap-4 sm:gap-6 md:grid-cols-3">
              <AugmentColumn title="Silver" stats={detail.augmentsByRarity.silver} />
              <AugmentColumn title="Gold" stats={detail.augmentsByRarity.gold} />
              <AugmentColumn title="Prismatic" stats={detail.augmentsByRarity.prismatic} />
            </div>
          </section>

          <section className="mt-10">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <h2 className="text-lg font-semibold text-zinc-100">Item Build</h2>
                {detail.itemBuild.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/20 p-3 text-sm text-zinc-600">
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
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Top Prismatic Items
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {detail.topPrismaticItems.length === 0 ? (
                      <p className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-3 text-sm text-zinc-600">
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
        </>
      )}
    </div>
  );
}
