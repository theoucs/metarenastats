"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Tooltip } from "@/components/Tooltip";

/**
 * Infobulle de survol pour un item ou un augment : son nom, et sa description
 * en jeu quand on l'a.
 *
 * Les descriptions ne sont **pas** importées avec le reste des données de jeu.
 * `gameData` est importé par trois composants client (MatchCard, StatsGrid,
 * StatsTable), donc tout ce qu'on y ajoute part dans le bundle de chaque page —
 * et les descriptions pèsent 19,5 Ko gzippés, plus que le reste réuni, pour un
 * contenu qui ne sert qu'au survol. Elles sont donc servies en statique depuis
 * `public/` et chargées une seule fois, à la demande.
 *
 * Le fichier est généré par `scripts/fetch-game-data.mjs`.
 */

export type EntityRef = { type: "item" | "augment"; id: number };

type DescriptionData = {
  items: Record<string, string>;
  augments: Record<string, string>;
};

// Cache au niveau du module : partagé par toutes les infobulles de la page, et
// conservé d'une navigation à l'autre puisque le module n'est évalué qu'une fois.
let cache: DescriptionData | null = null;
let inFlight: Promise<DescriptionData | null> | null = null;
// Les abonnés sont les infobulles déjà montées quand le chargement se termine :
// sans eux, une bulle ouverte pendant la requête resterait vide jusqu'au
// survol suivant.
const subscribers = new Set<(data: DescriptionData) => void>();

function loadDescriptions(): Promise<DescriptionData | null> {
  if (cache) return Promise.resolve(cache);
  inFlight ??= fetch("/entity-descriptions.json")
    .then((res) => (res.ok ? res.json() : null))
    .then((data: DescriptionData | null) => {
      cache = data;
      if (data) for (const notify of subscribers) notify(data);
      return data;
    })
    .catch((error) => {
      // Une infobulle n'est pas critique : en cas d'échec on retombe sur le nom
      // seul, et une tentative ultérieure reste possible.
      console.error("[tooltip] descriptions indisponibles :", error);
      inFlight = null;
      return null;
    });
  return inFlight;
}

function useDescription(entity: EntityRef | undefined, active: boolean): string | undefined {
  const [data, setData] = useState<DescriptionData | null>(cache);

  // `entity` est un objet littéral, recréé à chaque rendu : le mettre tel quel
  // en dépendance relancerait l'effet à chaque fois. Une page joueur monte ~900
  // de ces composants, autant ne pas le payer.
  const hasEntity = entity !== undefined;

  useEffect(() => {
    // Rien n'est téléchargé tant que l'utilisateur n'a pas approché une icône :
    // beaucoup de visites ne survolent jamais rien.
    if (!active || !hasEntity || cache) return;
    let alive = true;
    const notify = (loaded: DescriptionData) => alive && setData(loaded);
    subscribers.add(notify);
    loadDescriptions().then((loaded) => {
      if (alive && loaded) setData(loaded);
    });
    return () => {
      alive = false;
      subscribers.delete(notify);
    };
  }, [active, hasEntity]);

  if (!entity || !data) return undefined;
  const table = entity.type === "item" ? data.items : data.augments;
  return table?.[String(entity.id)];
}

/**
 * Enveloppe un élément d'une infobulle « nom + description ».
 *
 * Sans `entity`, ou tant que la description n'est pas chargée, seul le nom
 * s'affiche — c'est exactement ce que faisaient les infobulles existantes, donc
 * rien ne régresse quand la donnée manque.
 */
export function EntityTooltip({
  entity,
  name,
  extra,
  children,
}: {
  entity?: EntityRef;
  name: string;
  /** Contenu additionnel (stats de la ligne, par exemple), sous la description. */
  extra?: ReactNode;
  children: ReactNode;
}) {
  // Le survol déclenche le chargement ; `armed` reste vrai ensuite, la donnée
  // étant de toute façon en cache.
  const [armed, setArmed] = useState(false);
  const description = useDescription(entity, armed);

  return (
    <span
      onPointerEnter={() => setArmed(true)}
      onFocus={() => setArmed(true)}
      className="contents"
    >
      <Tooltip
        content={
          <span className="block max-w-[260px] text-left">
            <span className="block font-semibold text-primary">{name}</span>
            {description && (
              // `whitespace-pre-line` : les sauts de ligne de la description
              // séparent les effets et portent du sens.
              <span className="mt-1 block whitespace-pre-line text-secondary">{description}</span>
            )}
            {extra && <span className="mt-1.5 block border-t border-subtle pt-1.5">{extra}</span>}
          </span>
        }
      >
        {children}
      </Tooltip>
    </span>
  );
}
