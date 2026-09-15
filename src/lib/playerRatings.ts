import { supabaseAdmin } from "@/lib/supabase";
import { TOP3_PLACEMENT_THRESHOLD } from "@/lib/aggregate";
import {
  RATING_MIN_GAMES,
  SIGMA,
  type Rating,
  type Tier,
  agedRating,
  newRating,
  rateMatch,
  tiersForLadder,
} from "@/lib/rating";

/**
 * Calcule le MMR de tous les joueurs suivis et en tire le classement.
 *
 * ─── POURQUOI TOUT RECALCULER À CHAQUE FOIS ─────────────────────────────────
 *
 * Le crawler ne découvre pas les parties dans l'ordre où elles ont été jouées :
 * il explore des joueurs, et récupère leur historique complet. Une partie
 * ingérée aujourd'hui peut dater de mai, et doit donc être notée AVANT des
 * parties déjà notées. Un calcul incrémental donnerait un classement qui dépend
 * de l'ordre de découverte au lieu de l'ordre de jeu — c'est-à-dire un
 * classement irreproductible.
 *
 * Tout rejouer coûte 2 087 parties et moins d'une seconde. La contrepartie
 * assumée : le rang d'un joueur peut bouger sans qu'il ait joué, quand une de
 * ses vieilles parties refait surface.
 */

/** Une ligne de `rating_matches()` : un match, ses joueurs, leurs placements.
 *  La date et l'identifiant forment le curseur de pagination — et l'ordre du
 *  calcul, qui EST le calcul : le MMR se construit partie après partie. */
type MatchRow = {
  game_creation: string;
  match_id: string;
  players: number[];
  subteams: number[];
  placements: number[];
};

type IdentityRow = {
  player_idx: number;
  puuid: string;
  riot_id: string;
  games: number;
};

const PAGE_SIZE = 1000;

/**
 * Les deux lectures de ce fichier paginent PAR CURSEUR et non par `Range`.
 *
 * PostgREST applique `Range` après la requête : chaque page réexécutait donc
 * l'agrégation complète pour n'en garder que 1 000 lignes. Sur 230 000
 * participations, c'était 4,3 s par page et une douzaine de pages — pour une
 * seule des deux lectures.
 *
 * Le curseur a un second mérite, découvert en production : il ne peut pas
 * rendre deux fois la même ligne. Avec un décalage, un joueur franchissant le
 * seuil de parties pendant la lecture décale les suivants, une ligne revient,
 * et l'upsert du classement échoue sur « ON CONFLICT DO UPDATE command cannot
 * affect row a second time » — ce qui faisait tomber tout le job de
 * publication.
 */
export type RatingReport = {
  matches: number;
  players: number;
  rated: number;
};

export async function refreshPlayerRatings(): Promise<RatingReport> {
  if (!supabaseAdmin) return { matches: 0, players: 0, rated: 0 };

  // Les joueurs découverts depuis la dernière passe reçoivent leur index.
  // AVANT toute lecture : `rating_input` joint `players` en jointure interne,
  // donc un joueur absent verrait ses parties disparaître du calcul sans le
  // moindre signal.
  const { data: added, error: syncError } = await supabaseAdmin.rpc("sync_players");
  if (syncError) throw syncError;
  if (added) console.log(`[rating] ${added} joueur(s) indexé(s)`);

  // Pagination PAR CURSEUR chronologique, et non par `Range`.
  //
  // PostgREST applique `Range` APRÈS la requête : chaque page réagrégeait donc
  // les 12 099 matchs pour n'en garder que 1 000, treize fois de suite (5,8 s
  // la page). Avec un curseur, chaque page ne calcule que sa tranche — 1,0 s,
  // et ça ne se dégrade pas quand la base grossit.
  const matches: MatchRow[] = [];
  let cursor = { created: "-infinity", match: "" };
  for (let page = 0; page < 1000; page++) {
    const { data, error } = await supabaseAdmin.rpc("rating_matches", {
      after_created: cursor.created,
      after_match: cursor.match,
      page_size: PAGE_SIZE,
    });
    if (error) throw error;
    const rows = (data ?? []) as MatchRow[];
    matches.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    const last = rows[rows.length - 1];
    cursor = { created: last.game_creation, match: last.match_id };
  }

  // Un tableau indexé par `player_idx` plutôt qu'une Map : les index sont
  // denses et contigus par construction (dense_rank), et on les touche
  // 37 000 fois.
  const ratings: Rating[] = [];
  const at = (idx: number) => (ratings[idx] ??= newRating());

  // Les compteurs du classement, accumulés dans la MÊME passe.
  //
  // Ils étaient recalculés à la lecture par une jointure sur les participations,
  // qui réévaluait l'exclusion AFK pour chacune : 1,1 s pour 50 joueurs. Or
  // cette boucle voit déjà chaque participation avec son placement — les
  // compter ici ne coûte rien, et garantit qu'ils portent exactement sur le
  // même échantillon que le rang.
  const counters: { games: number; top3: number; top1: number; sum: number }[] = [];
  const countFor = (idx: number) => (counters[idx] ??= { games: 0, top3: 0, top1: 0, sum: 0 });

  // ─── PLUSIEURS PASSES SUR LA MÊME HISTOIRE ─────────────────────────────────
  //
  // Les premières parties d'un joueur sont jugées contre des adversaires encore
  // notés à la valeur par défaut : le résultat est réel, mais l'attente à
  // laquelle on le compare ne vaut rien. Rejouer l'histoire en repartant des
  // notes finales corrige ce biais de départ — c'est une approximation bon
  // marché de TrueSkill Through Time, qui fait la même chose proprement en
  // propageant l'information dans les deux sens du temps.
  //
  // Mesuré le 2026-09-15 sur 12 219 parties (entraînement 85 %, test sur les
  // 15 % jamais vus), prédiction du duel entre deux équipes :
  //
  //                    tous les duels   joueurs à 3+ parties   à 10+ parties
  //   1 passe             50,5 %              52,4 %              56,7 %
  //   3 passes            50,7 %              53,4 %              60,2 %
  //   5 passes            50,8 %              53,4 %              61,7 %
  //
  // Le gain porte exactement là où il sert : sur les joueurs qu'on classe
  // vraiment. Trois passes en captent l'essentiel et la courbe est plate
  // ensuite — prendre cinq reviendrait à choisir le maximum observé sur le jeu
  // de test, ce qui n'est pas une mesure mais une coïncidence.
  const PASSES = 3;

  for (let pass = 0; pass < PASSES; pass++) {
    // On garde ce qu'on a appris (mu) mais on rouvre l'incertitude : le joueur
    // retraverse son histoire avec ce qu'on a fini par savoir de lui.
    if (pass > 0) {
      for (let i = 0; i < ratings.length; i++) {
        if (ratings[i]) ratings[i] = { mu: ratings[i].mu, sigma: SIGMA };
      }
    }

    for (const match of matches) {
      // Les trois tableaux sont alignés (même ordre d'agrégation côté SQL).
      const teams = new Map<number, { players: number[]; placement: number }>();
      for (let i = 0; i < match.players.length; i++) {
        const placement = match.placements[i];
        // Les compteurs ne dépendent pas des notes : une seule passe suffit.
        if (pass === 0) {
          const c = countFor(match.players[i]);
          c.games++;
          c.sum += placement;
          if (placement <= TOP3_PLACEMENT_THRESHOLD) c.top3++;
          if (placement === 1) c.top1++;
        }

        const team = teams.get(match.subteams[i]);
        if (team) team.players.push(match.players[i]);
        else teams.set(match.subteams[i], { players: [match.players[i]], placement });
      }
      if (teams.size < 2) continue;

      const rosters = [...teams.values()];
      const updated = rateMatch(
        rosters.map((t) => t.players.map((idx) => agedRating(at(idx)))),
        rosters.map((t) => t.placement),
      );
      rosters.forEach((roster, i) => {
        roster.players.forEach((idx, j) => {
          ratings[idx] = updated[i][j];
        });
      });
    }
  }

  // Curseur, pour la même raison que rating_matches : `Range` s'applique après
  // la requête, donc chaque page réagrégeait les 230 000 participations (4,3 s
  // l'une, douze pages). Et un curseur sur un identifiant croissant ne peut pas
  // rendre deux fois la même ligne, contrairement à un décalage recalculé
  // pendant que le crawler écrit.
  const identities: IdentityRow[] = [];
  let afterIdx = 0;
  for (let page = 0; page < 1000; page++) {
    const { data, error } = await supabaseAdmin.rpc("rating_players", {
      min_games: RATING_MIN_GAMES,
      after_idx: afterIdx,
      page_size: PAGE_SIZE,
    });
    if (error) throw error;
    const batch = (data ?? []) as IdentityRow[];
    identities.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    afterIdx = batch[batch.length - 1].player_idx;
  }

  // Ordre du classement. Les ex æquo sont départagés par le nombre de parties
  // puis par le puuid : sans cela deux passes identiques pourraient rendre deux
  // classements différents, et un joueur verrait son rang bouger sans raison.
  // Dédoublonnage AVANT le classement.
  //
  // La lecture de `rating_players` est paginée, et le crawler écrit pendant ce
  // temps : un joueur qui franchit le seuil de 5 parties entre deux pages
  // décale les suivants, et une ligne peut revenir deux fois. L'upsert échoue
  // alors avec « ON CONFLICT DO UPDATE command cannot affect row a second
  // time », et tout le job de publication tombe — pour une cause invisible
  // dans le message.
  const uniqueIdentities = [...new Map(identities.map((row) => [row.puuid, row])).values()];
  if (uniqueIdentities.length !== identities.length) {
    console.log(
      `[rating] ${identities.length - uniqueIdentities.length} doublon(s) de pagination écarté(s)`,
    );
  }

  const ladder = uniqueIdentities
    .map((row) => ({ ...row, rating: at(row.player_idx) }))
    .sort(
      (a, b) =>
        b.rating.mu - a.rating.mu ||
        Number(b.games) - Number(a.games) ||
        (a.puuid < b.puuid ? -1 : 1),
    );

  const tiers: Tier[] = tiersForLadder(ladder.length);
  // Une seule et même estampille pour toute la passe : c'est elle qui
  // distingue ensuite ce que cette passe a écrit de ce qu'elle a laissé.
  const stamp = new Date().toISOString();
  const rows = ladder.map((entry, i) => ({
    puuid: entry.puuid,
    riot_id: entry.riot_id,
    games: Number(entry.games),
    top3_wins: countFor(entry.player_idx).top3,
    top1_wins: countFor(entry.player_idx).top1,
    placement_sum: countFor(entry.player_idx).sum,
    mu: entry.rating.mu,
    sigma: entry.rating.sigma,
    rank_position: i + 1,
    tier: tiers[i],
    updated_at: stamp,
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from("player_ratings")
      .upsert(rows.slice(i, i + 500), { onConflict: "puuid" });
    if (error) throw error;
  }

  // Un joueur peut sortir du classement (partie retirée par la règle AFK, ou
  // match supprimé). On efface ce que cette passe n'a pas réécrit, plutôt que
  // de laisser un rang périmé qu'aucun recalcul ne rattrapera.
  //
  // Le tri se fait sur l'estampille et non sur une liste de puuid : 969 puuid
  // de 78 caractères dans une URL, c'est 80 Ko, et PostgREST refuse sans même
  // renvoyer de message d'erreur.
  if (rows.length > 0) {
    const { error, count } = await supabaseAdmin
      .from("player_ratings")
      .delete({ count: "exact" })
      .lt("updated_at", stamp);
    if (error) throw error;
    if (count) console.log(`[rating] ${count} joueur(s) sorti(s) du classement`);
  }

  return { matches: matches.length, players: ratings.length, rated: rows.length };
}

/** Le seuil à partir duquel un joueur passe en « suivi » dans la file de crawl.
 *  Plus bas que RATING_MIN_GAMES : on veut approfondir ceux qui APPROCHENT du
 *  classement, pas seulement ceux qui y sont déjà. */
const TRACKED_FROM_GAMES = 3;

/**
 * Bascule en mode suivi les joueurs dont on connaît déjà plusieurs parties.
 *
 * Ce n'est pas du calcul de classement, mais c'est ce qui le nourrit : sans
 * profondeur, le MMR reste une opinion sur 1,6 partie par joueur. Voir
 * pickPlayers dans lib/crawler.ts pour l'autre moitié du mécanisme.
 */
export async function promoteTrackedPlayers(): Promise<number> {
  if (!supabaseAdmin) return 0;
  const { data, error } = await supabaseAdmin.rpc("promote_tracked_players", {
    min_games: TRACKED_FROM_GAMES,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

export type PlayerRank = {
  tier: Tier;
  position: number;
  games: number;
  /** Combien de joueurs sont classés — un rang ne se lit pas sans son total. */
  outOf: number;
};

/** Le rang d'un joueur, ou `null` s'il n'a pas assez de parties suivies. */
export async function getPlayerRank(puuid: string): Promise<PlayerRank | null> {
  if (!supabaseAdmin) return null;
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    supabaseAdmin
      .from("player_ratings")
      .select("tier, rank_position, games")
      .eq("puuid", puuid)
      .maybeSingle(),
    supabaseAdmin.from("player_ratings").select("puuid", { count: "exact", head: true }),
  ]);
  if (error) throw error;
  if (countError) throw countError;
  if (!data) return null;
  return {
    tier: data.tier as Tier,
    position: data.rank_position,
    games: data.games,
    outOf: count ?? 0,
  };
}
