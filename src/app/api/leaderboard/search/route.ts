import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { toStat } from "@/lib/aggregate";

/**
 * Cherche un joueur dans TOUT le classement, pas seulement dans le millier
 * publié.
 *
 * La page du classement est statique : elle transporte le top 1000 dans son
 * HTML, et son filtre ne peut donc trouver que ceux-là. Or un joueur cherche
 * d'abord son propre pseudo, et il est presque toujours au-delà — 11 294
 * classés pour 1 000 affichés. Sans cette route, le filtre lui répondait
 * « aucun résultat » alors qu'il est classé.
 *
 * Une requête ciblée sur `player_ratings` (11 000 lignes, indexée sur le rang)
 * plutôt qu'un élargissement du snapshot : publier tout le monde ferait une
 * page de plusieurs mégaoctets pour un besoin qui ne concerne qu'une ligne à
 * la fois.
 */
export const dynamic = "force-dynamic";

/** Au-delà, ce n'est plus une recherche mais un parcours : on renvoie à la
 *  page classement, qui est faite pour ça. */
const MAX_RESULTS = 25;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  // Deux caractères, sinon la moitié du classement remonte.
  if (query.length < 2 || !supabaseAdmin) return NextResponse.json({ players: [] });

  // `%` et `_` sont les jokers de LIKE : un joueur dont le pseudo en contient
  // ferait autrement une recherche qui ne veut plus rien dire.
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);

  const { data, error } = await supabaseAdmin
    .from("player_ratings")
    .select("puuid, riot_id, games, top3_wins, top1_wins, placement_sum, rank_position, tier")
    .ilike("riot_id", `%${escaped}%`)
    .order("rank_position", { ascending: true })
    .limit(MAX_RESULTS);
  if (error) throw error;

  const players = (data ?? []).map((r) => ({
    puuid: r.puuid as string,
    riotId: r.riot_id as string,
    tier: r.tier as string,
    position: r.rank_position as number,
    // Dénominateur 0 : `playRate` vaut alors 0, et le classement ne l'affiche
    // pas (c'est une colonne des tier lists). Le calculer demandait
    // `site_totals`, qui compte trois valeurs distinctes sur 217 000 lignes —
    // 8,4 s pour une recherche qui doit répondre pendant la frappe.
    ...toStat(
      {
        games: Number(r.games),
        top3Wins: Number(r.top3_wins),
        top1Wins: Number(r.top1_wins),
        placementSum: Number(r.placement_sum),
      },
      0,
    ),
  }));

  return NextResponse.json({ players });
}
