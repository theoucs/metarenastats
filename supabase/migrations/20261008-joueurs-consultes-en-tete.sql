-- Les joueurs consultés passent en tête de file du crawler. Appliquée le 2026-10-08.
--
-- Une page joueur charge les 30 dernières parties chez Riot, mais sous le débit
-- partagé avec le crawler une partie des appels revient en 429 et ces parties
-- manquent aux stats. Le crawler, lui, ne visitait jamais ce joueur : 202 713
-- joueurs suivis jamais visités, dont 35 000 avant lui, pour ~15 places par
-- passe. Cas réel : un Kled à 3e place absent du Top Champions d'un joueur.
--
-- `requested_at` note la visite de la page ; le crawler sert d'abord les
-- joueurs demandés depuis leur dernier passage, et lit leur historique entier.

alter table crawl_queue add column if not exists requested_at timestamptz;

create index if not exists crawl_queue_requested_idx
  on crawl_queue (requested_at)
  where requested_at is not null;

-- Une demande déjà en attente garde sa place (pas de recul à chaque visite), et
-- un joueur visité il y a moins d'une heure n'est pas redemandé : il n'a
-- presque rien joué depuis.
create or replace function request_player_crawl(p_puuid text)
returns void
language sql
as $function$
  insert into crawl_queue (puuid, priority, requested_at)
  values (p_puuid, 1, now())
  on conflict (puuid) do update
    set requested_at = case
          when crawl_queue.requested_at > coalesce(crawl_queue.last_crawled_at, '-infinity')
            then crawl_queue.requested_at
          else now()
        end,
        priority = greatest(crawl_queue.priority, 1)
    where crawl_queue.last_crawled_at is null
       or crawl_queue.last_crawled_at < now() - interval '1 hour';
$function$;

create or replace function pick_requested_players(max_rows integer)
returns table (puuid text)
language sql
stable
as $function$
  select q.puuid
  from crawl_queue q
  where q.requested_at is not null
    and q.error_count < 5
    and (q.last_crawled_at is null or q.last_crawled_at < q.requested_at)
  order by q.requested_at
  limit max_rows;
$function$;

revoke all on function request_player_crawl(text) from public, anon, authenticated;
revoke all on function pick_requested_players(integer) from public, anon, authenticated;
grant execute on function request_player_crawl(text) to service_role;
grant execute on function pick_requested_players(integer) to service_role;
