import type { Tier } from "@/lib/rating";

/**
 * Le rang Arena d'un joueur (Iron → Challenger) : l'emblème officiel de la
 * ranked, puis le nom en texte neutre.
 *
 * Il était écrit en capitales dans une pastille aux couleurs du palier. Mais
 * Grandmaster y sortait dans le rouge des mauvais chiffres et Emerald dans leur
 * vert, deux couleurs que le site réserve au verdict d'une stat. L'emblème dit
 * le palier mieux qu'une teinte (c'est l'image que le joueur connaît déjà),
 * et le texte n'a plus besoin de couleur. Décidé avec Théo le 2026-09-28.
 *
 * Les images viennent de CommunityDragon (ranked-emblem), recadrées sur
 * l'emblème et réduites à 96 px dans public/img/rank : les originaux font
 * 1280×720 de vide autour d'un blason, jusqu'à 230 Ko pièce.
 */
export function RankBadge({
  tier,
  size = "sm",
  iconOnly = false,
}: {
  tier: Tier;
  size?: "sm" | "lg";
  /** The emblem alone, name kept for screen readers and on hover: the phone
   *  card has no room for "Grandmaster" next to the name and the stat. */
  iconOnly?: boolean;
}) {
  const lg = size === "lg";
  return (
    <span className={`inline-flex shrink-0 items-center align-middle ${lg ? "gap-2" : "gap-1.5"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/img/rank/${tier.toLowerCase()}.webp`}
        alt=""
        width={96}
        height={96}
        title={iconOnly ? tier : undefined}
        className={lg ? "h-9 w-9" : "h-7 w-7"}
      />
      <span
        className={
          iconOnly ? "sr-only" : lg ? "font-display text-body font-semibold text-primary" : "text-small text-secondary"
        }
      >
        {tier}
      </span>
    </span>
  );
}
