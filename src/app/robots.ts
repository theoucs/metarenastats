import type { MetadataRoute } from "next";

/**
 * Les robots d'indexation restent hors des pages joueur et des routes d'API.
 *
 * Une page joueur n'est jamais mise en cache et coûte ~32 appels Riot à chaque
 * affichage (compte, historique, 30 matchs) — sur la même clé que le crawler et
 * les visiteurs, soit un tiers des 100 appels / 2 min d'une clé de dev. Un
 * robot qui suit une poignée de liens partagés suffirait à la vider.
 *
 * Les tier lists, elles, sont servies depuis des snapshots : les indexer ne
 * coûte rien, et c'est ce qu'on veut voir remonter dans les moteurs.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/players/", "/api/"],
    },
  };
}
