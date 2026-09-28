-- Le classement lit la carrière, plus les seuls patchs publiés.
--
-- Constaté le 2026-09-28 : depuis l'archivage du 24/09, `participants_clean` ne
-- contient plus que les deux patchs publiés. `leaderboard_top` y recomptait les
-- parties de chaque joueur, donc :
--   - Joyless#EUW, n° 1, affichait 4 parties à 1,00 au lieu de 35 à 1,37 ;
--   - la jointure interne faisait disparaître tout joueur sans partie récente
--     (rangs 3, 7 et 15 absents, « Top 911 » au lieu de 1 000).
--
-- `player_ratings` porte déjà les compteurs de toute la carrière, écrits par la
-- même passe qui calcule le rang (src/lib/playerRatings.ts), et c'est ce que lit
-- déjà la recherche du classement (/api/leaderboard/search). Les deux chemins
-- disent désormais la même chose, et le rang et ses chiffres viennent de la
-- même passe. Plus de jointure : plus rien ne peut faire tomber une ligne.

create or replace function public.leaderboard_top(max_rows integer)
returns table(puuid text, riot_id text, games bigint, top3_wins bigint, top1_wins bigint,
              placement_sum bigint, rank_position integer, tier text)
language sql
stable
as $function$
  select r.puuid, r.riot_id,
         r.games::bigint, r.top3_wins::bigint, r.top1_wins::bigint, r.placement_sum::bigint,
         r.rank_position, r.tier
  from player_ratings r
  order by r.rank_position
  limit max_rows
$function$;
