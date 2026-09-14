/**
 * Le MMR Arena, et le rang qu'on en tire.
 *
 * ─── POURQUOI PAS UN CLASSEMENT PAR PLACEMENT MOYEN ──────────────────────────
 *
 * Parce qu'un placement moyen ne dit pas CONTRE QUI il a été fait. Finir 3e sur
 * 6 contre les meilleurs joueurs suivis vaut mieux que finir 2e contre des
 * joueurs à leur première partie, et aucune moyenne ne sait faire la
 * différence. Arena ajoute une seconde raison : on joue à trois. Le placement
 * est celui de l'ÉQUIPE, donc porté par les teammates autant que par le joueur.
 *
 * ─── LE MODÈLE : WENG-LIN / PLACKETT-LUCE ────────────────────────────────────
 *
 * C'est le modèle derrière OpenSkill, successeur libre de TrueSkill, conçu pour
 * exactement notre forme de partie : plusieurs équipes, plusieurs joueurs par
 * équipe, un classement complet en sortie (et pas un simple gagnant/perdant).
 *
 *   Weng & Lin, « A Bayesian Approximation Method for Online Ranking » (2011)
 *   https://jmlr.csail.mit.edu/papers/volume12/weng11a/weng11a.pdf
 *
 * Chaque joueur porte une force `mu` et une incertitude `sigma`. La force d'une
 * équipe est la somme de ses membres, ce qui donne gratuitement ce qu'on
 * cherchait : le gain dépend des adversaires ET des teammates. Une équipe qui
 * gagne alors qu'elle était la plus faible sur le papier prend beaucoup ; la
 * même victoire en étant favorite ne rapporte presque rien.
 *
 * `sigma` fait le reste du travail : un joueur vu une fois garde l'incertitude
 * de départ, donc son `mu` bouge à peine et il reste collé à la moyenne. Mesuré
 * sur nos données : écart-type du `mu` de ±1,6 à 1-2 parties contre ±7,1 à
 * 20-49 parties. Personne ne peut squatter le haut du classement avec une bonne
 * partie unique — il n'y a rien à exclure, le modèle s'en charge.
 *
 * ─── CE QUE ÇA VAUT VRAIMENT ─────────────────────────────────────────────────
 *
 * Validé sur des matchs synthétiques à compétence connue : corrélation 0,83
 * entre la vraie compétence et le `mu` retrouvé.
 *
 * Sur nos données réelles, en prédisant chaque match AVANT de l'apprendre, le
 * duel entre deux équipes est deviné dans 55,3 % des cas (± 1,9 sur 2 838
 * duels), et 59,8 % quand tous les joueurs ont 3 parties connues. C'est
 * au-dessus du hasard, mais mince — et ce sera mince tant qu'on aura 1,6 partie
 * par joueur. Le même algorithme sur 135 parties par joueur retrouve 0,83.
 * Autrement dit : le classement s'améliore tout seul à mesure que le crawler
 * approfondit, sans rien changer ici.
 */

/** Force de départ. La valeur exacte n'a pas de sens en soi — seul l'écart
 *  entre joueurs compte — mais 25 est la convention TrueSkill/OpenSkill. */
export const MU = 25;
/** Incertitude de départ. La règle du modèle est sigma = mu / 3. */
export const SIGMA = MU / 3;
/** L'aléa qu'on prête au mode lui-même : deux équipes de force égale ne
 *  finissent pas dans un ordre fixe. Testé de MU/6 à MU, sans effet mesurable
 *  sur la prédiction (59,5 % à 60,3 %) : on garde la valeur par défaut. */
export const BETA = SIGMA / 2;
/** Le niveau d'un joueur dérive avec le temps : on rouvre un peu l'incertitude
 *  à chaque partie, sinon un joueur très suivi se fige sur son passé. */
export const TAU = SIGMA / 100;
/** Plancher : sigma ne doit jamais atteindre 0, sinon le joueur devient
 *  inamovible et plus aucune partie ne le corrige. */
const KAPPA = 1e-4;

export type Rating = { mu: number; sigma: number };

export function newRating(): Rating {
  return { mu: MU, sigma: SIGMA };
}

/** L'incertitude rouverte avant de noter une partie, sans jamais dépasser
 *  l'incertitude d'un inconnu. */
export function agedRating(r: Rating): Rating {
  return { mu: r.mu, sigma: Math.min(Math.sqrt(r.sigma ** 2 + TAU ** 2), SIGMA) };
}

/**
 * Note une partie et rend les forces mises à jour, équipe par équipe.
 *
 * `teams[i]` est l'effectif de l'équipe i, `placements[i]` son classement dans
 * la partie (1 = vainqueur ; les ex æquo sont acceptés). Fonction pure : elle
 * ne lit et n'écrit rien, ce qui la rend testable sur des cas connus.
 */
export function rateMatch(teams: Rating[][], placements: number[]): Rating[][] {
  const teamMu = teams.map((t) => t.reduce((s, p) => s + p.mu, 0));
  const teamSigma2 = teams.map((t) => t.reduce((s, p) => s + p.sigma ** 2, 0));

  // Échelle commune de la partie : plus les joueurs sont incertains, plus les
  // écarts de force pèsent peu, et plus les corrections sont prudentes.
  const c = Math.sqrt(teamSigma2.reduce((s, v) => s + v + BETA ** 2, 0));
  const strength = teamMu.map((mu) => Math.exp(mu / c));

  // Le dénominateur de Plackett-Luce à la position q : la somme des équipes
  // ENCORE EN LICE à ce moment-là, c'est-à-dire classées q ou moins bien.
  // (Prendre celles déjà arrivées produit un classement qui s'effondre : tout
  // le monde dérive vers le bas, le signal disparaît.)
  const remaining = placements.map((rank) =>
    strength.reduce((s, v, k) => (placements[k] >= rank ? s + v : s), 0),
  );
  // Nombre d'équipes à égalité, pour partager le crédit entre elles.
  const tied = placements.map((rank) => placements.filter((r) => r === rank).length);

  return teams.map((team, i) => {
    let omega = 0; // combien la force de l'équipe doit monter ou descendre
    let delta = 0; // combien la partie a réduit l'incertitude

    for (let q = 0; q < teams.length; q++) {
      if (placements[q] > placements[i]) continue; // q est arrivé après i
      const share = strength[i] / remaining[q];
      if (q === i) omega += (1 - share) / tied[q];
      else omega -= share / tied[q];
      delta += (share * (1 - share)) / tied[q];
    }

    omega *= teamSigma2[i] / c;
    delta *= (teamSigma2[i] / c ** 2) * (Math.sqrt(teamSigma2[i]) / c);

    return team.map((player) => {
      // Chaque joueur reçoit la part du résultat proportionnelle à ce qu'on
      // ignorait de lui : le nouveau prend le gros de la correction, le joueur
      // déjà bien cerné ne bouge qu'à peine.
      const share = player.sigma ** 2 / teamSigma2[i];
      return {
        mu: player.mu + share * omega,
        sigma: player.sigma * Math.sqrt(Math.max(1 - share * delta, KAPPA)),
      };
    });
  });
}

// ─── DU MMR AU RANG ──────────────────────────────────────────────────────────

/** En dessous, aucun rang n'est affiché : le `mu` n'a pas eu de quoi bouger. */
export const RATING_MIN_GAMES = 5;

export const TIERS = [
  "Challenger",
  "Grandmaster",
  "Master",
  "Diamond",
  "Emerald",
  "Platinum",
  "Gold",
  "Silver",
  "Bronze",
  "Iron",
] as const;

export type Tier = (typeof TIERS)[number];

/**
 * Répartition des paliers non-apex, aux pourcentages de la ranked LoL
 * (relevés en août 2026). Renormalisés sur ce qui reste une fois l'apex servi.
 */
const SHARES: [Tier, number][] = [
  ["Diamond", 4],
  ["Emerald", 13],
  ["Platinum", 18],
  ["Gold", 24],
  ["Silver", 21],
  ["Bronze", 16],
  ["Iron", 3.4],
];

/**
 * Le palier de chaque position du classement, du meilleur au dernier.
 *
 * Challenger et Grandmaster sont des effectifs FIXES, comme en ranked : un
 * titre qui se dilue quand la population grandit ne veut plus rien dire. Master
 * suit le pool (1 %), et le reste prend les pourcentages de la ranked.
 *
 * Les plafonds ne mordent que sur un petit classement : à 969 joueurs on est
 * déjà à 10 et 15. Ils existent pour que le jour où la table ne contient que
 * 40 joueurs, on n'en sacre pas 10 Challengers.
 */
export function tiersForLadder(size: number): Tier[] {
  if (size <= 0) return [];

  const challenger = Math.min(10, Math.max(1, Math.round(size * 0.01)));
  const grandmaster = Math.min(15, Math.max(1, Math.round(size * 0.015)));
  const master = Math.max(1, Math.round(size * 0.01));

  const out: Tier[] = [];
  const push = (tier: Tier, n: number) => {
    for (let i = 0; i < n && out.length < size; i++) out.push(tier);
  };
  push("Challenger", challenger);
  push("Grandmaster", grandmaster);
  push("Master", master);

  // Le reste, réparti aux pourcentages de la ranked. On calcule des frontières
  // cumulées plutôt que des effectifs arrondis un par un : arrondir chaque
  // palier séparément perd ou invente des joueurs à la fin.
  const rest = size - out.length;
  if (rest > 0) {
    const total = SHARES.reduce((s, [, pct]) => s + pct, 0);
    let cumulative = 0;
    let placed = 0;
    for (const [tier, pct] of SHARES) {
      cumulative += pct;
      const boundary = Math.round((rest * cumulative) / total);
      push(tier, boundary - placed);
      placed = boundary;
    }
  }
  // Un arrondi peut laisser une place vide : le dernier palier la prend.
  while (out.length < size) out.push("Iron");
  return out;
}
