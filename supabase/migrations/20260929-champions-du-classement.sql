-- Les trois champions les plus joués de chaque joueur, au classement. Appliquée le 2026-09-29.
--
-- Parties publiées (match_participants) ET archivées (player_champion_totals) :
-- l'archivage retire les participations des vieux patchs, ne compter que les
-- premières montrerait les champions du dernier mois.
--
-- Mesuré à froid sur le top 1 000 : 10,4 s, presque tout en lectures d'index
-- dispersées (~10 ms par joueur). Trop pour la publication, qui frôle déjà ses
-- 300 s : c'est la phase classement qui le range dans `player_ratings`, une
-- fois par heure. La recherche au-delà du top, elle, appelle la fonction sur
-- ses 25 lignes au plus.
create or replace function player_top_champions(p_puuids text[])
returns table(puuid text, champions text[])
language sql
stable
as $$
  select pl.puuid, tc.champions
  from players pl
  cross join lateral (
    select array_agg(c.champion order by c.games desc, c.champion) as champions
    from (
      select x.champion, sum(x.games) as games
      from (
        select mp.champion, count(*) as games
        from match_participants mp where mp.player_id = pl.id group by mp.champion
        union all
        select t.champion, sum(t.games) from player_champion_totals t
        where t.player_id = pl.id group by t.champion
      ) x
      group by x.champion
      order by 2 desc, 1
      limit 3
    ) c
  ) tc
  where pl.puuid = any(p_puuids)
$$;

revoke execute on function player_top_champions(text[]) from public, anon, authenticated;
grant execute on function player_top_champions(text[]) to service_role;

alter table player_ratings add column if not exists top_champions text[];

create or replace function refresh_ladder_champions(top_n integer)
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  touched integer;
begin
  update player_ratings r
  set top_champions = c.champions
  from player_top_champions(
    array(select puuid from player_ratings where rank_position <= top_n)
  ) c
  where r.puuid = c.puuid
    and r.top_champions is distinct from c.champions;
  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke execute on function refresh_ladder_champions(integer) from public, anon, authenticated;
grant execute on function refresh_ladder_champions(integer) to service_role;

drop function if exists leaderboard_top(integer);

create function leaderboard_top(max_rows integer)
returns table(puuid text, riot_id text, games bigint, top3_wins bigint, top1_wins bigint,
              placement_sum bigint, rank_position integer, tier text, mu double precision,
              teammate_mu double precision, opponent_mu double precision, top_champions text[])
language sql
stable
as $$
  select r.puuid, r.riot_id,
         r.games::bigint, r.top3_wins::bigint, r.top1_wins::bigint, r.placement_sum::bigint,
         r.rank_position, r.tier, r.mu::double precision,
         r.teammate_mu::double precision, r.opponent_mu::double precision, r.top_champions
  from player_ratings r
  order by r.rank_position
  limit max_rows
$$;

grant execute on function leaderboard_top(integer) to service_role;
