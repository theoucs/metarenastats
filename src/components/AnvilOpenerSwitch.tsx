"use client";

import { useState } from "react";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { SlidingHighlight, useSlidingHighlight } from "@/components/SlidingHighlight";
import {
  EntityIcon,
  avgPlacementColor,
  top1Color,
  top3Color,
  type EntityRarity,
} from "@/lib/statsDisplay";

/** Les quatre chiffres d'un lot de parties. Miroir de `AnvilOutcome` côté
 *  agrégation — redéclaré plutôt qu'importé pour que ce composant ne tire pas
 *  lib/aggregate.ts (et ses dépendances serveur) dans le bundle client. */
export type Outcome = {
  games: number;
  avgPlacement: number;
  top3Rate: number;
  top1Rate: number;
};

export type OpenerOption = {
  augmentId: number;
  name: string;
  iconUrl?: string;
  rarity?: EntityRarity;
  /** Les parties ouvertes par cet augment qui sont parties en enclumes. */
  anvil: Outcome;
  /** Les mêmes ouvertures, mais le joueur a acheté des items. */
  bought: Outcome;
  rows: StatsRow[];
};

/** La clé « pas de filtre ». Une chaîne et non `null` : elle sert d'identité au
 *  surlignage glissant, qui indexe ses boutons par clé. */
const ALL = "all";

/**
 * Le sélecteur de premier augment de la tier list Anvil Run.
 *
 * ─── POURQUOI UN BANDEAU *ET* UN FILTRE ─────────────────────────────────────
 *
 * Les deux ne répondent pas à la même question, et n'ont pas la même solidité.
 *
 * Le bandeau répond à « j'ouvre sur cet augment, est-ce que je pars en
 * enclumes ? ». Il s'appuie sur le lot entier — 3 000 à 5 500 parties par
 * augment — donc il tranche vraiment. C'est lui qui porte le message.
 *
 * Le tableau répond à « avec quel champion ». Il découpe ces mêmes parties en
 * 173 champions, et le mieux fourni en garde 35. Il est indicatif, et la page
 * le dit. Le seuil (voir ANVIL_OPENER_MIN_GAMES) existe pour qu'on n'affiche
 * pas une ligne à 2 parties avec un rang devant.
 *
 * Les deux vues viennent du même snapshot et sont déjà en mémoire : basculer
 * ne déclenche aucune requête, comme pour le sélecteur de patch.
 */
export function AnvilOpenerSwitch({
  baseRows,
  baseOutcome,
  openers,
  linkPrefix,
  linkSuffix,
}: {
  /** Tous les anvil runs, premier augment confondu. */
  baseRows: StatsRow[];
  baseOutcome: Outcome;
  openers: OpenerOption[];
  linkPrefix?: string;
  linkSuffix?: string;
}) {
  const [selected, setSelected] = useState<string>(ALL);
  const { containerRef, register, rect } = useSlidingHighlight(selected, openers.length);

  const opener = openers.find((o) => String(o.augmentId) === selected);

  // Un snapshot écrit avant cette fonctionnalité n'a pas d'ouvertures : entre
  // le déploiement et le passage suivant du job, la page doit rester la tier
  // list qu'elle était plutôt qu'un sélecteur sans options.
  if (openers.length === 0) {
    return (
      <StatsTable
        rows={baseRows}
        linkPrefix={linkPrefix}
        linkSuffix={linkSuffix}
        playRateLabel="% Anvil Run"
        filterPlaceholder="Search a champion"
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col items-start gap-1.5 text-small sm:flex-row sm:items-center sm:gap-2">
        <span className="shrink-0 text-muted">First augment:</span>
        <div
          ref={containerRef}
          className="relative inline-flex flex-wrap rounded-lg border border-subtle bg-inset p-1"
        >
          <SlidingHighlight rect={rect} />
          <OpenerPill
            active={selected === ALL}
            register={register(ALL)}
            onClick={() => setSelected(ALL)}
            label="Any"
          />
          {openers.map((o) => (
            <OpenerPill
              key={o.augmentId}
              active={selected === String(o.augmentId)}
              register={register(String(o.augmentId))}
              onClick={() => setSelected(String(o.augmentId))}
              label={o.name}
              iconUrl={o.iconUrl}
              rarity={o.rarity}
            />
          ))}
        </div>
      </div>

      {opener && <OpenerComparison opener={opener} baseline={baseOutcome} />}

      {/* Au-dessus du tableau, pas en dessous : sous 170 lignes, la mise en
          garde n'atteindrait que les lecteurs qui ont déjà tiré leurs
          conclusions. */}
      {opener && (
        <p className="mb-3 text-micro text-muted">
          Champions under 10 anvil runs on this opener are hidden. Even above it the sample is thin
          — the table is a hint, the panel above is the solid number.
        </p>
      )}

      <StatsTable
        // Remonter le tableau à chaque bascule : sans ça React réutilise
        // l'instance, et le filtre texte comme le tri restent ceux de la vue
        // précédente alors que les lignes, elles, ont changé.
        key={selected}
        rows={opener ? opener.rows : baseRows}
        linkPrefix={linkPrefix}
        linkSuffix={linkSuffix}
        playRateLabel={opener ? "% of Anvil Runs" : "% Anvil Run"}
        filterPlaceholder="Search a champion"
      />
    </>
  );
}

function OpenerPill({
  active,
  register,
  onClick,
  label,
  iconUrl,
  rarity,
}: {
  active: boolean;
  register: (el: HTMLElement | null) => void;
  onClick: () => void;
  label: string;
  iconUrl?: string;
  rarity?: EntityRarity;
}) {
  return (
    <button
      type="button"
      ref={register}
      onClick={onClick}
      aria-pressed={active}
      className={`relative z-10 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-[color,transform] duration-75 active:scale-[0.97] ${
        active ? "text-primary" : "text-muted hover:text-secondary"
      }`}
    >
      {iconUrl && <EntityIcon iconUrl={iconUrl} rarity={rarity} sizeClass="h-5 w-5" />}
      {label}
    </button>
  );
}

/**
 * Les trois lignes qui répondent à la question.
 *
 * L'ordre n'est pas décoratif : la référence d'abord, puis les deux chemins
 * qu'ouvre l'augment. On lit de haut en bas « voilà la normale, voilà ce que
 * donne l'enclume, voilà ce que donne la boutique ».
 *
 * Et les deux écarts se lisent contre la MÊME référence, pas l'un contre
 * l'autre : c'est ce qui les rend comparables entre eux. Le verdict que le
 * lecteur cherche — enclume ou boutique — se lit alors directement entre les
 * deux lignes, sans qu'on ait à le lui asséner.
 */
function OpenerComparison({ opener, baseline }: { opener: OpenerOption; baseline: Outcome }) {
  return (
    <div className="mb-4 rounded-xl border border-subtle bg-raised/40 p-3 shadow-[var(--elev-1)] sm:p-4">
      <div className="flex items-center gap-2">
        {opener.iconUrl && (
          <EntityIcon iconUrl={opener.iconUrl} rarity={opener.rarity} sizeClass="h-7 w-7" />
        )}
        <h2 className="font-display text-h2 font-semibold text-primary">
          {opener.name} as first augment
        </h2>
      </div>

      <table className="mt-3 w-full border-collapse text-small">
        <thead>
          <tr className="text-micro uppercase tracking-wide text-muted">
            <th className="pb-1.5 text-left font-medium">Then</th>
            <th className="pb-1.5 pl-2 text-right font-medium">
              {/* « Avg » à 390 px : le nom entier y passait à la ligne et
                  volait sa largeur aux colonnes de chiffres. */}
              <span className="sm:hidden">Avg</span>
              <span className="hidden sm:inline">Avg Placement</span>
            </th>
            <th className="pb-1.5 pl-2 text-right font-medium">% Top 1</th>
            <th className="pb-1.5 pl-2 text-right font-medium">% Top 3</th>
            <th className="pb-1.5 pl-2 text-right font-medium">Games</th>
          </tr>
        </thead>
        <tbody>
          <ComparisonRow label="All anvil runs" note="baseline" outcome={baseline} />
          <ComparisonRow
            label="Went anvil run"
            outcome={opener.anvil}
            baseline={baseline}
            emphasis
          />
          <ComparisonRow label="Bought items instead" outcome={opener.bought} baseline={baseline} />
        </tbody>
      </table>
    </div>
  );
}

function ComparisonRow({
  label,
  note,
  outcome,
  baseline,
  emphasis = false,
}: {
  label: string;
  note?: string;
  outcome: Outcome;
  /** Absente sur la ligne de référence, qui ne se compare pas à elle-même —
   *  et qui reste donc en gris. Colorer le point zéro en rouge parce que les
   *  anvil runs placent au-dessus de 3,70 en moyenne le faisait lire comme un
   *  verdict, alors que c'est l'étalon contre lequel les deux autres lignes
   *  sont jugées. */
  baseline?: Outcome;
  emphasis?: boolean;
}) {
  const reference = baseline === undefined;
  // Un lot vide se lit « — » : afficher 0,00 de placement moyen sur zéro partie
  // ferait passer une absence de données pour un résultat parfait.
  const empty = outcome.games === 0;
  const color = (fn: (n: number) => string, value: number) =>
    reference || empty ? undefined : fn(value);
  const delta = (theirs: number, ours: number) => (baseline && !empty ? ours - theirs : undefined);

  return (
    <tr className={`border-t border-subtle ${emphasis ? "bg-overlay/40" : ""}`}>
      <td className={`py-2 pr-2 ${reference ? "text-muted" : "text-secondary"}`}>
        <span className={emphasis ? "font-medium text-primary" : undefined}>{label}</span>
        {note && (
          <span className="ml-1.5 text-micro uppercase tracking-wide text-muted">{note}</span>
        )}
      </td>
      <Cell
        value={empty ? "—" : outcome.avgPlacement.toFixed(2)}
        colorClass={color(avgPlacementColor, outcome.avgPlacement)}
        emphasis={emphasis}
        // Plus bas = mieux : le signe qui décide de la couleur s'inverse par
        // rapport au texte affiché, qui reste l'écart brut.
        better={
          baseline && !empty ? baseline.avgPlacement - outcome.avgPlacement : undefined
        }
        deltaText={formatDelta(delta(baseline?.avgPlacement ?? 0, outcome.avgPlacement), 2)}
      />
      <Cell
        value={empty ? "—" : pct(outcome.top1Rate)}
        colorClass={color(top1Color, outcome.top1Rate)}
        better={delta(baseline?.top1Rate ?? 0, outcome.top1Rate)}
        deltaText={formatDelta(delta(baseline?.top1Rate ?? 0, outcome.top1Rate), 1, "pp", 100)}
      />
      <Cell
        value={empty ? "—" : pct(outcome.top3Rate)}
        colorClass={color(top3Color, outcome.top3Rate)}
        better={delta(baseline?.top3Rate ?? 0, outcome.top3Rate)}
        deltaText={formatDelta(delta(baseline?.top3Rate ?? 0, outcome.top3Rate), 1, "pp", 100)}
      />
      <Cell value={outcome.games.toLocaleString("en-US")} />
    </tr>
  );
}

/** Sous ce seuil (2 centièmes de place, 0,2 point de pourcentage) l'écart n'est
 *  plus un signal mais du bruit d'arrondi : il reste affiché, sans verdict de
 *  couleur. */
const DELTA_NOISE = 0.002;

function Cell({
  value,
  colorClass,
  emphasis = false,
  better,
  deltaText,
}: {
  value: string;
  colorClass?: string;
  emphasis?: boolean;
  /** Signé « positif = mieux », quelle que soit la métrique : c'est lui qui
   *  décide de la couleur, jamais le texte affiché. */
  better?: number;
  deltaText?: string;
}) {
  return (
    <td className="py-2 pl-2 text-right align-top">
      <span
        className={`block font-mono [font-variant-numeric:tabular-nums] ${
          emphasis ? "text-body font-semibold" : ""
        } ${colorClass ?? "text-secondary"}`}
      >
        {value}
      </span>
      {/* Sous la valeur et non à côté : en ligne, les cinq colonnes ne tenaient
          pas dans 390 px et le panneau partait en défilement horizontal. */}
      {deltaText && better !== undefined && (
        <span
          className={`block font-mono text-micro [font-variant-numeric:tabular-nums] ${
            Math.abs(better) < DELTA_NOISE
              ? "text-muted"
              : better > 0
                ? "text-stat-good"
                : "text-stat-bad"
          }`}
        >
          {deltaText}
        </span>
      )}
    </td>
  );
}

const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;

/** L'écart tel qu'il s'affiche : brut et signé, dans l'unité de la colonne.
 *  `scale` convertit une fraction en points de pourcentage. */
function formatDelta(value: number | undefined, digits: number, unit = "", scale = 1) {
  if (value === undefined) return undefined;
  const shown = value * scale;
  const sign = shown > 0 ? "+" : shown < 0 ? "−" : "±";
  return `${sign}${Math.abs(shown).toFixed(digits)}${unit}`;
}
