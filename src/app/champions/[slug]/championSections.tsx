import Link from "next/link";
import {
  SHARDBLADE_ITEM_ID,
  unpackStat,
  unpackItemStat,
  type ChampionAugmentStat,
  type ChampionItemSlot,
  type ChampionItemSlotStat,
  type PackedStat,
  type PackedItemStat,
  type Stat,
} from "@/lib/aggregate";
import { resolveItem, itemStatName, resolveAugment, itemCategory } from "@/lib/gameData";
import { EntityTooltip } from "@/components/EntityTooltip";
import { type StatsRow } from "@/components/StatsTable";
import {
  EntityIcon,
  top1Color,
  top3Color,
  avgPlacementColor,
  MiniStat,
  MiniStatHeader,
} from "@/lib/statsDisplay";

/**
 * Les blocs partagés entre le résumé d'un champion et ses onglets.
 *
 * Ils vivaient dans `page.tsx` quand la page était seule. Le résumé montre un
 * extrait de chaque sujet et l'onglet correspondant le déroule en entier : les
 * deux doivent se ressembler, donc ils partagent les mêmes blocs plutôt que
 * d'en entretenir deux versions.
 */

/** Les chiffres d'une entité, sous son nom et sa description dans l'infobulle —
 *  le nom est rendu par EntityTooltip, il ne doit pas être répété ici. */
export function StatTooltipContent({ stat }: { stat: Stat }) {
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

/** Le lien d'un extrait vers l'onglet qui le déroule. */
export function SeeAllLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 text-small font-medium text-accent transition-colors hover:text-primary"
    >
      {children} <span aria-hidden="true">→</span>
    </Link>
  );
}

export function AugmentCard({ stat }: { stat: ChampionAugmentStat }) {
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

export function AugmentColumn({ title, stats }: { title: string; stats: ChampionAugmentStat[] }) {
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

export function ShardbladeRateBlock({ rate }: { rate: number }) {
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

export function PrismaticItemCard({ stat }: { stat: ChampionItemSlotStat }) {
  const info = resolveItem(stat.itemId);
  if (!info) return null;
  return (
    <div className="rounded-lg border border-subtle bg-raised/40 p-3">
      <div className="flex items-center gap-2.5">
        <EntityTooltip entity={{ type: "item", id: stat.itemId }} name={itemStatName(stat.itemId)}>
          <EntityIcon iconUrl={info.iconUrl} rarity="prismatic" />
        </EntityTooltip>
        <span className="min-w-0 flex-1 truncate text-body font-medium text-primary">
          {itemStatName(stat.itemId)}
        </span>
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

/** Les cinq chiffres d'une ligne « enclume », avec leur en-tête. */
export function AnvilStatRow({ stat }: { stat: Stat }) {
  return (
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
  );
}

// Sits beside Item Build in a 2-column layout — full-height sidebar panel
// rather than a small header-row card, so it no longer leaves a hole under
// itself when Item Build's slots take up more vertical space.
export function AnvilRunPanel({
  stat,
  shardbladeRate,
  topPrismaticItems,
  seeAllHref,
}: {
  stat: Stat;
  shardbladeRate: number;
  topPrismaticItems: ChampionItemSlotStat[];
  seeAllHref: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-h2 font-semibold text-primary">Anvil Run</h2>
        <SeeAllLink href={seeAllHref}>See all</SeeAllLink>
      </div>
      <p className="mt-0.5 text-small text-secondary">Stat anvils only, no items bought.</p>

      <AnvilStatRow stat={stat} />
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

export function ItemSlotBlock({ slot }: { slot: ChampionItemSlot }) {
  const [primary, ...alts] = slot.items;
  const primaryInfo = primary ? resolveItem(primary.itemId) : undefined;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-micro font-semibold uppercase tracking-wide text-muted">Slot {slot.slot}</div>

      {primaryInfo && primary && (
        <>
          <EntityTooltip
            entity={{ type: "item", id: primary.itemId }}
            name={itemStatName(primary.itemId)}
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
                name={itemStatName(alt.itemId)}
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

// ─── Des listes empaquetées aux lignes des tableaux ────────────────────────────
//
// Les onglets réutilisent la même grille que les tier lists du site
// (TieredStatsTabs), qui attend des `StatsRow`. Le dénominateur est TOUJOURS le
// nombre de parties du champion : sur ces pages, « % Played » répond à « sur
// combien de mes parties », pas « sur combien de parties du patch ».

export function augmentRowsByRarity(
  packed: PackedStat[],
  champGames: number,
): Record<string, StatsRow[]> {
  const byRarity: Record<string, StatsRow[]> = { silver: [], gold: [], prismatic: [] };
  for (const entry of packed) {
    const stat = unpackStat(entry, champGames);
    const info = resolveAugment(stat.id);
    const rarity = info?.tier;
    if (!info || !rarity || !(rarity in byRarity)) continue;
    byRarity[rarity].push({
      key: String(stat.id),
      entity: { type: "augment", id: stat.id },
      name: info.name,
      iconUrl: info.iconUrl,
      rarity: rarity as StatsRow["rarity"],
      games: stat.games,
      top3Rate: stat.top3Rate,
      top1Rate: stat.top1Rate,
      avgPlacement: stat.avgPlacement,
      playRate: stat.playRate,
    });
  }
  return byRarity;
}

export function itemRowsByRarity(
  packed: PackedItemStat[],
  champGames: number,
): Record<string, StatsRow[]> {
  const byRarity: Record<string, StatsRow[]> = { legendary: [], prismatic: [] };
  for (const entry of packed) {
    const stat = unpackItemStat(entry, champGames);
    const info = resolveItem(stat.itemId);
    // Bottes et pool de boutique comptent comme « Legendary » ici, exactement
    // comme sur la tier list générale : seuls les prismatiques ont leur onglet.
    const isPrismatic = itemCategory(stat.itemId) === "prismatic";
    byRarity[isPrismatic ? "prismatic" : "legendary"].push({
      key: String(stat.itemId),
      entity: { type: "item", id: stat.itemId },
      name: itemStatName(stat.itemId),
      iconUrl: info?.iconUrl,
      rarity: isPrismatic ? "prismatic" : undefined,
      games: stat.games,
      top3Rate: stat.top3Rate,
      top1Rate: stat.top1Rate,
      avgPlacement: stat.avgPlacement,
      playRate: stat.playRate,
      // Colonnes brutes, tier corrigé — voir adjustedItemStats.
      tierStat: stat.tierStat,
    });
  }
  return byRarity;
}
