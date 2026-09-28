-- Deux correctifs de l'audit du 2026-09-28. Appliquée le 2026-09-28.

-- ─── UN SEUL RECALCUL À LA FOIS ─────────────────────────────────────────────
--
-- Le moteur (engine.yml) et le filet horaire (refresh-stats.yml) ont chacun
-- leur groupe de concurrence GitHub : rien n'empêchait deux phases `ratings`
-- simultanées. Or la phase efface en fin de course les lignes de
-- `player_ratings` plus vieilles que SON estampille — si l'autre passe a écrit
-- entre-temps avec une estampille antérieure, tout ce qu'elle a écrit part.
-- Deux `refresh materialized view concurrently` simultanés, eux, échouent.
--
-- Un groupe de concurrence commun ne convenait pas : le moteur tient le sien
-- 5 h 30, le filet horaire aurait attendu tout ce temps. D'où un bail en base,
-- que chaque phase prend et rend, et qui expire seul si la fonction meurt.
--
-- Pas de verrou consultatif (`pg_advisory_lock`) : PostgREST sert chaque
-- requête sur une connexion du pool, un verrou de session ne survivrait pas à
-- l'appel qui l'a pris.
create table if not exists job_locks (
  name text primary key,
  holder text not null,
  locked_until timestamptz not null
);

grant select, insert, update, delete on job_locks to service_role;

-- Rend true si le bail est pris, null sinon (aucune ligne insérée ni modifiée).
create or replace function try_job_lock(p_name text, p_holder text, p_ttl_seconds integer)
returns boolean
language sql
volatile
as $$
  insert into job_locks as l (name, holder, locked_until)
  values (p_name, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
    set holder = excluded.holder, locked_until = excluded.locked_until
    where l.locked_until < now()
  returning true
$$;

-- Ne rend que son propre bail : un appel arrivé après expiration ne doit pas
-- libérer celui qu'une autre passe a pris depuis.
create or replace function release_job_lock(p_name text, p_holder text)
returns void
language sql
volatile
as $$
  delete from job_locks where name = p_name and holder = p_holder
$$;

grant execute on function try_job_lock(text, text, integer) to service_role;
grant execute on function release_job_lock(text, text) to service_role;

-- ─── RETROUVER UN JOUEUR CONNU PAR SON PSEUDO ───────────────────────────────
--
-- Chemin de repli de la page joueur quand Riot ne répond pas. C'était un
-- `ilike` sur `players.riot_id` sans index : parcours complet de la table
-- (4,6 s mesurés à 245 000 joueurs, 346 000 aujourd'hui), et `%`/`_` dans un
-- pseudo servaient de jokers. Une égalité sur `lower(riot_id)`, indexée.
create index if not exists players_riot_id_lower_idx on players (lower(riot_id));

create or replace function find_player_by_riot_id(p_riot_id text)
returns table (puuid text, riot_id text)
language sql
stable
as $$
  select p.puuid, p.riot_id
  from players p
  where lower(p.riot_id) = lower(p_riot_id)
  limit 1
$$;

grant execute on function find_player_by_riot_id(text) to service_role;
