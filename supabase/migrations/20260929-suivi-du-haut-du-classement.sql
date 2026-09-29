-- Suivi du haut du classement, et entourage de chaque joueur. Appliquée le 2026-09-29.

-- ─── LE SUIVI NE SUIVAIT PERSONNE ───────────────────────────────────────────
--
-- `priority = 1` devait approfondir les joueurs du classement. Mais on y entre
-- dès 3 parties connues : 180 000 joueurs le 29/09, dont 92 % jamais visités,
-- pour ~2 500 visites par jour. Le plus ancien passage d'abord, donc les jamais
-- visités d'abord : on n'en voyait jamais le bout, et personne n'y était revu.
-- 8 des 10 premiers du classement n'avaient JAMAIS été crawlés eux-mêmes —
-- toutes leurs parties venaient d'historiques d'autres joueurs — et 45 du top
-- 100 n'avaient aucune partie suivie depuis 14 jours.
--
-- `priority = 2` : le haut du classement, reposé à chaque passe classement.
-- Le crawler le sert en premier (voir pickPlayers), sans jamais revoir un même
-- joueur avant quelques heures. Qui sort du haut redescend en suivi ordinaire.
create or replace function mark_ladder_top(top_n integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  marked integer;
begin
  update crawl_queue q
  set priority = 1
  where q.priority = 2
    and not exists (
      select 1 from player_ratings r
      where r.puuid = q.puuid and r.rank_position <= top_n
    );

  -- Un joueur classé est toujours dans la file (tout participant ingéré y
  -- entre) ; l'insertion ne couvre que l'exception, sans rien écraser.
  insert into crawl_queue (puuid, priority)
  select r.puuid, 2
  from player_ratings r
  where r.rank_position <= top_n
  on conflict (puuid) do update
    set priority = 2
    where crawl_queue.priority <> 2;
  get diagnostics marked = row_count;
  return marked;
end;
$$;

revoke execute on function mark_ladder_top(integer) from public, anon, authenticated;
grant execute on function mark_ladder_top(integer) to service_role;

-- ─── L'ENTOURAGE D'UN JOUEUR ────────────────────────────────────────────────
--
-- Le MMR moyen de ses coéquipiers et de ses adversaires, sur toutes ses parties
-- connues. C'est ce qui explique un rang que le placement moyen ne suffit pas à
-- expliquer : gagner avec des coéquipiers très forts rapporte peu.
alter table player_ratings add column if not exists teammate_mu real;
alter table player_ratings add column if not exists opponent_mu real;

drop function if exists leaderboard_top(integer);

create function leaderboard_top(max_rows integer)
returns table(puuid text, riot_id text, games bigint, top3_wins bigint, top1_wins bigint,
              placement_sum bigint, rank_position integer, tier text, mu double precision,
              teammate_mu double precision, opponent_mu double precision)
language sql
stable
as $$
  select r.puuid, r.riot_id,
         r.games::bigint, r.top3_wins::bigint, r.top1_wins::bigint, r.placement_sum::bigint,
         r.rank_position, r.tier, r.mu::double precision,
         r.teammate_mu::double precision, r.opponent_mu::double precision
  from player_ratings r
  order by r.rank_position
  limit max_rows
$$;

grant execute on function leaderboard_top(integer) to service_role;
