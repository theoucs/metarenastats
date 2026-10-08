import Link from "next/link";
import {
  ANVIL_OPENER_AUGMENTS,
  SHARDBLADE_ITEM_ID,
  unpackStat,
  unpackItemStat,
  type AnvilOutcome,
  type ChampionAnvilOpening,
  type ChampionAugmentStat,
  type ChampionItemSlot,
  type ChampionItemSlotStat,
  type PackedStat,
  type PackedItemStat,
  type Stat,
} from "@/lib/aggregate";
import { resolveItem, itemStatName, resolveAugment, itemCategory } from "@/lib/gameData";
import { EntityTooltip, type EntityRef } from "@/components/EntityTooltip";
import { type StatsRow } from "@/components/StatsTable";
import {
  EntityIcon,
  top1Color,
  top3Color,
  avgPlacementColor,
  MiniStat,
  MiniStatHeader,
  formatCount,
  type EntityRarity,
  type StatScale,
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
        <span>Games: {formatCount(stat.games)}</span>
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

/** One row of a MiniStatTable: an item or augment with its numbers. */
export type MiniStatRow = {
  key: string;
  entity: EntityRef;
  name: string;
  iconUrl: string;
  rarity?: EntityRarity;
  stat: Stat;
};

/**
 * The compact tables of the champion summary: one header, one line per entry,
 * numbers packed to the right.
 *
 * They replace a card per entry, whose five numbers were spread over the full
 * card width with their labels far above them: the eye lost the line.
 * `columns="short"` keeps Avg, Top 3 and Games (Avg leads, as everywhere) for
 * the narrow three-up augment columns and the anvil sidebar; the tab has the
 * rest.
 *
 * `scale` comes from the champion's WHOLE list for that category, not from the
 * five rows shown: those are the best by construction, and a scale built on
 * them alone would paint the fifth best red.
 */
export function MiniStatTable({
  rows,
  columns = "full",
  scale,
}: {
  rows: MiniStatRow[];
  columns?: "full" | "short";
  scale?: StatScale;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-subtle bg-raised/20 p-3 text-small text-muted">No data yet.</p>
    );
  }
  const full = columns === "full";
  const num = "whitespace-nowrap py-2 pl-4 text-right tabular-nums";
  return (
    <table className="w-full border-collapse text-small">
      <thead>
        <tr className="border-b border-subtle text-micro uppercase tracking-wide text-muted">
          <th className="pb-1.5 text-left font-medium">
            <span className="sr-only">Name</span>
          </th>
          <th className="whitespace-nowrap pb-1.5 pl-4 text-right font-medium">Avg</th>
          {full && <th className="whitespace-nowrap pb-1.5 pl-4 text-right font-medium">Top 1</th>}
          <th className="whitespace-nowrap pb-1.5 pl-4 text-right font-medium">Top 3</th>
          <th className="whitespace-nowrap pb-1.5 pl-4 text-right font-medium">Games</th>
          {full && <th className="whitespace-nowrap pb-1.5 pl-4 text-right font-medium">Played</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, entity, name, iconUrl, rarity, stat }) => (
          <tr key={key} className="border-b border-subtle last:border-0">
            {/* w-full: the name takes the spare width and the numbers pack to
                the right edge, instead of spreading across the table. Long
                names wrap rather than truncate. */}
            <td className="w-full py-2">
              <span className="flex items-center gap-2">
                <EntityTooltip entity={entity} name={name}>
                  <EntityIcon iconUrl={iconUrl} rarity={rarity} sizeClass="h-7 w-7" />
                </EntityTooltip>
                <span className="font-medium leading-tight text-primary">{name}</span>
              </span>
            </td>
            <td className={`${num} font-medium ${avgPlacementColor(stat.avgPlacement, scale, stat.games)}`}>
              {stat.avgPlacement.toFixed(2)}
            </td>
            {full && (
              <td className={`${num} ${top1Color(stat.top1Rate, scale, stat.games)}`}>
                {(stat.top1Rate * 100).toFixed(0)}%
              </td>
            )}
            <td className={`${num} ${top3Color(stat.top3Rate, scale, stat.games)}`}>
              {(stat.top3Rate * 100).toFixed(0)}%
            </td>
            <td className={`${num} text-secondary`}>{formatCount(stat.games)}</td>
            {full && <td className={`${num} text-secondary`}>{(stat.playRate * 100).toFixed(0)}%</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function augmentMiniRows(stats: ChampionAugmentStat[]): MiniStatRow[] {
  return stats.flatMap((stat) => {
    const info = resolveAugment(stat.augmentId);
    if (!info) return [];
    return [
      {
        key: String(stat.augmentId),
        entity: { type: "augment" as const, id: stat.augmentId },
        name: info.name,
        iconUrl: info.iconUrl,
        rarity: info.tier as EntityRarity,
        stat,
      },
    ];
  });
}

export function prismaticItemMiniRows(stats: ChampionItemSlotStat[]): MiniStatRow[] {
  return stats.flatMap((stat) => {
    const info = resolveItem(stat.itemId);
    if (!info) return [];
    return [
      {
        key: String(stat.itemId),
        entity: { type: "item" as const, id: stat.itemId },
        name: itemStatName(stat.itemId),
        iconUrl: info.iconUrl,
        rarity: "prismatic" as const,
        stat,
      },
    ];
  });
}

export function AugmentColumn({
  title,
  stats,
  scale,
}: {
  title: string;
  stats: ChampionAugmentStat[];
  scale?: StatScale;
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-small font-semibold text-secondary">{title}</h3>
      <MiniStatTable rows={augmentMiniRows(stats)} columns="short" scale={scale} />
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
        <div className="truncate tabular-nums text-small font-medium text-primary">
          {(rate * 100).toFixed(0)}% of anvil games
        </div>
      </div>
    </div>
  );
}

/**
 * Les anvil runs de ce champion, selon l'augment qui les a ouverts.
 *
 * Les quatre augments d'enclume sont regroupés en une seule ligne — voir le
 * commentaire dans `getChampionDetail`. Séparés, la plupart des champions
 * n'auraient pas dix parties par augment ; regroupés, l'écart se lit, et il
 * vaut environ une demi-place sur tous les champions mesurés.
 *
 * Même forme de tableau que le bandeau de /anvil, volontairement : c'est la
 * même question posée à deux échelles, elle doit se lire pareil.
 */
export function AnvilOpeningBlock({ opening }: { opening: ChampionAnvilOpening }) {
  return (
    <div className="mt-4 rounded-xl border border-subtle bg-raised/40 p-3 shadow-[var(--elev-1)]">
      <h3 className="text-small font-semibold uppercase tracking-wide text-muted">
        Opening augment
      </h3>

      <table className="mt-2 w-full border-collapse text-small">
        <thead>
          <tr className="text-micro uppercase tracking-wide text-muted">
            <th className="pb-1.5 text-left font-medium">
              {/* Le libellé entier passait à la ligne à 390 px et volait sa
                  largeur aux colonnes de chiffres. */}
              <span className="sm:hidden">Started on</span>
              <span className="hidden sm:inline">Anvil runs that started on</span>
            </th>
            <th className="pb-1.5 pl-2 text-right font-medium">Avg</th>
            <th className="pb-1.5 pl-2 text-right font-medium">Top 1</th>
            <th className="pb-1.5 pl-2 text-right font-medium">Top 3</th>
            <th className="pb-1.5 pl-2 text-right font-medium">Games</th>
          </tr>
        </thead>
        <tbody>
          <OpeningRow label={<StatAnvilLabel />} outcome={opening.statAnvil} emphasis />
          <OpeningRow label="Anything else" outcome={opening.other} />
        </tbody>
      </table>
    </div>
  );
}

/** Les quatre icônes plutôt que leurs quatre noms : côte à côte les noms font
 *  trois lignes, et l'infobulle de chaque icône dit déjà lequel est lequel. */
function StatAnvilLabel() {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1">
        {ANVIL_OPENER_AUGMENTS.map((id) => {
          const info = resolveAugment(id);
          if (!info) return null;
          return (
            <EntityTooltip key={id} entity={{ type: "augment", id }} name={info.name}>
              <EntityIcon
                iconUrl={info.iconUrl}
                rarity={info.tier as "silver" | "gold" | "prismatic" | undefined}
                sizeClass="h-5 w-5"
              />
            </EntityTooltip>
          );
        })}
      </span>
      <span className="font-medium text-primary">A stat anvil</span>
    </span>
  );
}

function OpeningRow({
  label,
  outcome,
  emphasis = false,
}: {
  label: React.ReactNode;
  outcome: AnvilOutcome;
  emphasis?: boolean;
}) {
  // Zéro partie se lit « — » : un placement moyen de 0,00 passerait pour un
  // résultat parfait alors que c'est une absence de données.
  const empty = outcome.games === 0;
  return (
    <tr className={`border-t border-subtle ${emphasis ? "bg-overlay/40" : ""}`}>
      <td className={`py-2 pr-2 ${emphasis ? "text-primary" : "text-secondary"}`}>{label}</td>
      <OpeningCell
        value={empty ? "—" : outcome.avgPlacement.toFixed(2)}
        colorClass={empty ? undefined : avgPlacementColor(outcome.avgPlacement)}
        emphasis={emphasis}
      />
      <OpeningCell
        value={empty ? "—" : `${(outcome.top1Rate * 100).toFixed(1)}%`}
        colorClass={empty ? undefined : top1Color(outcome.top1Rate)}
      />
      <OpeningCell
        value={empty ? "—" : `${(outcome.top3Rate * 100).toFixed(1)}%`}
        colorClass={empty ? undefined : top3Color(outcome.top3Rate)}
      />
      <OpeningCell value={String(outcome.games)} />
    </tr>
  );
}

function OpeningCell({
  value,
  colorClass,
  emphasis = false,
}: {
  value: string;
  colorClass?: string;
  emphasis?: boolean;
}) {
  return (
    <td className="py-2 pl-2 text-right">
      <span
        className={`tabular-nums ${
          emphasis ? "font-semibold" : ""
        } ${colorClass ?? "text-secondary"}`}
      >
        {value}
      </span>
    </td>
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
/** Le corps de la section Anvil Run, sur toute la largeur : les chiffres
 *  globaux à gauche, les prismatiques à droite. En colonne latérale à côté
 *  d'Item Build, ses 3 prismatiques face aux 6 d'à côté laissaient un trou. */
export function AnvilRunPanel({
  stat,
  shardbladeRate,
  topPrismaticItems,
  scale,
}: {
  stat: Stat;
  shardbladeRate: number;
  topPrismaticItems: ChampionItemSlotStat[];
  /** Built on the champion's whole anvil item list, see MiniStatTable. */
  scale?: StatScale;
}) {
  return (
    <div className="mt-4 grid gap-8 md:grid-cols-[320px_minmax(0,1fr)]">
      <div>
        <h3 className="mb-2 text-small font-semibold text-secondary">All anvil games</h3>
        <AnvilStatRow stat={stat} />
        <ShardbladeRateBlock rate={shardbladeRate} />
      </div>
      <div className="min-w-0">
        <h3 className="mb-2 text-small font-semibold text-secondary">Top prismatic items</h3>
        <MiniStatTable rows={prismaticItemMiniRows(topPrismaticItems)} scale={scale} />
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
          <div className="tabular-nums text-micro text-secondary">{(primary.playRate * 100).toFixed(0)}%</div>
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
