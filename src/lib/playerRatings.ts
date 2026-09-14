import { supabaseAdmin } from "@/lib/supabase";
import {
  RATING_MIN_GAMES,
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

/** Une ligne de `rating_matches()` : un match, ses joueurs, leurs placements. */
type MatchRow = {
  /** Rang chronologique du match. C'est l'ordre du calcul, pas un identifiant. */
  ord: number;
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
 * PostgREST plafonne toute réponse à 1 000 lignes, y compris celle d'un RPC.
 *
 * `orderBy` n'est pas décoratif : sans tri EXPLICITE, deux pages d'une même
 * lecture peuvent se recouvrir ou se manquer, et on ne l'apprend que par des
 * chiffres faux. Le projet a déjà payé ce bug une fois (voir la pagination des
 * participants dans lib/aggregate.ts).
 */
async function readAll<T>(
  rpc: string,
  orderBy: string,
  args: Record<string, unknown> = {},
): Promise<T[]> {
  if (!supabaseAdmin) return [];
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabaseAdmin
      .rpc(rpc, args)
      .order(orderBy, { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

export type RatingReport = {
  matches: number;
  players: number;
  rated: number;
};

export async function refreshPlayerRatings(): Promise<RatingReport> {
  if (!supabaseAdmin) return { matches: 0, players: 0, rated: 0 };

  const matches = await readAll<MatchRow>("rating_matches", "ord");

  // Un tableau indexé par `player_idx` plutôt qu'une Map : les index sont
  // denses et contigus par construction (dense_rank), et on les touche
  // 37 000 fois.
  const ratings: Rating[] = [];
  const at = (idx: number) => (ratings[idx] ??= newRating());

  for (const match of matches) {
    // Les trois tableaux sont alignés (même ordre d'agrégation côté SQL).
    const teams = new Map<number, { players: number[]; placement: number }>();
    for (let i = 0; i < match.players.length; i++) {
      const team = teams.get(match.subteams[i]);
      if (team) team.players.push(match.players[i]);
      else teams.set(match.subteams[i], { players: [match.players[i]], placement: match.placements[i] });
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

  const identities = await readAll<IdentityRow>("rating_players", "player_idx", {
    min_games: RATING_MIN_GAMES,
  });

  // Ordre du classement. Les ex æquo sont départagés par le nombre de parties
  // puis par le puuid : sans cela deux passes identiques pourraient rendre deux
  // classements différents, et un joueur verrait son rang bouger sans raison.
  const ladder = identities
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
