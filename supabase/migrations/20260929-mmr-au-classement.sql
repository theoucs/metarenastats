-- Le MMR affiché au classement. Appliquée le 2026-09-29.
--
-- Le classement est trié par `mu` mais ne le montrait pas : un joueur à 1,26 de
-- placement moyen classé derrière un joueur à 1,37 n'avait rien pour
-- comprendre pourquoi (ses coéquipiers, plus forts, prennent une plus grande
-- part de ses victoires). `mu` s'ajoute en dernière colonne : l'ancien code,
-- qui ne la lit pas, reste compatible pendant le déploiement.
drop function if exists leaderboard_top(integer);

create function leaderboard_top(max_rows integer)
returns table(puuid text, riot_id text, games bigint, top3_wins bigint, top1_wins bigint,
              placement_sum bigint, rank_position integer, tier text, mu double precision)
language sql
stable
as $$
  select r.puuid, r.riot_id,
         r.games::bigint, r.top3_wins::bigint, r.top1_wins::bigint, r.placement_sum::bigint,
         r.rank_position, r.tier, r.mu::double precision
  from player_ratings r
  order by r.rank_position
  limit max_rows
$$;

grant execute on function leaderboard_top(integer) to service_role;
