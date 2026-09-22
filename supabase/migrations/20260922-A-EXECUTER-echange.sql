-- ════════════════════════════════════════════════════════════════════════════
-- À EXÉCUTER DANS LE SQL EDITOR DE SUPABASE — 2026-09-22
-- ════════════════════════════════════════════════════════════════════════════
--
-- État au moment où ce fichier est écrit :
--   · match_participants      1 376 082 lignes · 732 Mo   ← lue par le site
--   · match_participants_v2   1 376 082 lignes · 313 Mo   ← prête, vérifiée
--   · moteur de crawl ARRÊTÉ (annulé à 15:11)
--
-- Les blocs se lancent DANS L'ORDRE. Entre le 1 et le 2, il y a une
-- vérification à lire : ne pas enchaîner à l'aveugle.
--
-- ⚠️  NE PAS RELANCER LE MOTEUR DE CRAWL avant la fin du bloc 3.

-- ════════════════════════════════════════════════════════════════════════════
-- BLOC 1 — Rattraper ce que le crawler a écrit depuis la copie
-- ════════════════════════════════════════════════════════════════════════════
--
-- La copie s'est faite pendant que le moteur tournait encore. Ce bloc reprend
-- les matchs touchés dans les trois dernières heures.
--
-- `do update` et non `do nothing` : la passe de timeline MET À JOUR
-- `item_order` sur des lignes déjà écrites. Un `do nothing` les laisserait à
-- leur valeur d'avant, et on perdrait des ordres d'achat sans s'en apercevoir.

insert into match_participants_v2 (
  match_id, player_id, subteam_id, placement, champion,
  kills, deaths, assists, augments, items, item_order
)
select p.match_id, pl.id::integer, p.subteam_id::smallint, p.placement::smallint,
       p.champion, p.kills::smallint, p.deaths::smallint, p.assists::smallint,
       p.augments, p.items, p.item_order
from match_participants p
join matches m on m.match_id = p.match_id
join players pl on pl.puuid = p.puuid
where m.ingested_at > now() - interval '3 hours'
   or m.timeline_fetched_at > now() - interval '3 hours'
on conflict (match_id, player_id) do update
  set subteam_id = excluded.subteam_id,
      placement  = excluded.placement,
      champion   = excluded.champion,
      kills      = excluded.kills,
      deaths     = excluded.deaths,
      assists    = excluded.assists,
      augments   = excluded.augments,
      items      = excluded.items,
      item_order = excluded.item_order;

-- ════════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — lire le résultat avant d'aller plus loin
-- ════════════════════════════════════════════════════════════════════════════
--
-- `ecart` DOIT valoir 0. S'il ne vaut pas 0, ARRÊTE-TOI et dis-le moi :
-- l'échange détruirait des lignes qui n'ont pas été recopiées.

select (select count(*) from match_participants)    as ancienne,
       (select count(*) from match_participants_v2) as nouvelle,
       (select count(*) from match_participants)
         - (select count(*) from match_participants_v2) as ecart;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOC 2 — L'échange
-- ════════════════════════════════════════════════════════════════════════════
--
-- C'est le seul pas irréversible. Tout en une transaction : ou bien la base
-- reste dans l'ancien état, ou bien elle passe entièrement dans le nouveau.
--
-- Les trois vues dépendent de la table par son nom : il faut les détruire avant
-- de renommer, puis les recréer sur la nouvelle forme.

begin;

drop materialized view if exists participants_published;
drop view if exists rating_input;
drop view if exists participants_clean;

drop table match_participants;
alter table match_participants_v2 rename to match_participants;

alter index match_participants_v2_pkey       rename to match_participants_pkey;
alter index match_participants_v2_player_idx rename to match_participants_player_idx;
alter index match_participants_v2_afk_idx    rename to match_participants_afk_idx;

grant select, insert, update, delete on match_participants to service_role;

-- ─── participants_clean ─────────────────────────────────────────────────────
-- Reprend la définition RÉELLEMENT en base (schema.sql avait divergé : sa
-- version n'avait ni `patch` ni `skill_bucket`). `puuid` et `riot_id` en
-- sortent, `player_id` les remplace.
create view participants_clean as
select
  p.match_id,
  p.player_id,
  p.subteam_id,
  p.placement,
  p.champion,
  p.kills,
  p.deaths,
  p.assists,
  p.augments,
  p.items,
  p.item_order,
  m.patch,
  case pr.tier
    when 'Challenger'::text  then 1
    when 'Grandmaster'::text then 1
    when 'Master'::text      then 1
    when 'Diamond'::text     then 2
    when 'Emerald'::text     then 2
    when 'Platinum'::text    then 3
    when 'Gold'::text        then 4
    when 'Silver'::text      then 5
    when 'Bronze'::text      then 5
    when 'Iron'::text        then 5
    else 0
  end::smallint as skill_bucket
from match_participants p
join matches m on m.match_id = p.match_id
left join players pl on pl.id = p.player_id
left join player_ratings pr on pr.puuid = pl.puuid
where not exists (
  select 1
  from match_participants afk
  where afk.match_id = p.match_id
    and afk.subteam_id = p.subteam_id
    and afk.items && array[220008, 220009, 220010, 220011]
);

grant select on participants_clean to service_role;

-- ─── participants_published ─────────────────────────────────────────────────
-- Règle INCHANGÉE : les deux patchs les plus récents à au moins 5 matchs, la
-- même que patch_options(). C'est ce qui fait que la bascule vers 16.19 se
-- produira toute seule. L'unique qui autorise `refresh concurrently` devient
-- (match_id, player_id), `id` ayant disparu.
create materialized view participants_published as
select pc.match_id,
       pc.player_id,
       pc.subteam_id,
       pc.placement,
       pc.champion,
       pc.augments,
       pc.items,
       pc.item_order,
       pc.skill_bucket,
       pc.patch
from participants_clean pc
where pc.patch in (
  select m.patch
  from matches m
  where m.patch is not null and m.ingested_at is not null
  group by m.patch
  having count(*) >= 5
  order by string_to_array(m.patch, '.')::int[] desc
  limit 2
);

create unique index participants_published_id_idx
  on participants_published (match_id, player_id);
create index participants_published_page_idx
  on participants_published (patch, match_id, player_id);

grant select on participants_published to service_role;

-- ─── rating_input ───────────────────────────────────────────────────────────
-- `player_idx` était un dense_rank() sur le puuid : un numéro fabriqué à chaque
-- lecture pour éviter de transporter 78 octets par ligne. `player_id` est ce
-- numéro, en vrai, et stable d'une passe à l'autre.
create view rating_input as
select
  p.match_id,
  p.player_id,
  p.subteam_id,
  p.placement,
  m.game_creation
from participants_clean p
join matches m on m.match_id = p.match_id;

grant select on rating_input to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOC 3 — Les fonctions qui lisaient le puuid des participations
-- ════════════════════════════════════════════════════════════════════════════

-- 3.1 — site_totals : le distinct porte sur 4 octets au lieu de 78.
create or replace function site_totals()
returns table (total_matches bigint, total_champions bigint, total_players bigint)
language sql
stable
as $$
  select count(distinct match_id), count(distinct champion), count(distinct player_id)
  from participants_clean
$$;

grant execute on function site_totals() to service_role;

-- 3.2 — leaderboard_top : un saut par `players` pour retrouver le player_id.
--       `player_ratings` reste clée par puuid ; 1 000 sondes d'index par appel.
create or replace function leaderboard_top(max_rows integer)
returns table (
  puuid text,
  riot_id text,
  games bigint,
  top3_wins bigint,
  top1_wins bigint,
  placement_sum bigint,
  rank_position integer,
  tier text
)
language sql
stable
as $$
  with top as (
    select r.puuid, r.riot_id, r.rank_position, r.tier, pl.id as player_id
    from player_ratings r
    join players pl on pl.puuid = r.puuid
    order by r.rank_position
    limit max_rows
  )
  select
    top.puuid,
    top.riot_id,
    count(p.*) as games,
    count(p.*) filter (where p.placement <= 3) as top3_wins,
    count(p.*) filter (where p.placement = 1) as top1_wins,
    sum(p.placement) as placement_sum,
    top.rank_position,
    top.tier
  from top
  join participants_clean p on p.player_id = top.player_id
  group by top.puuid, top.riot_id, top.rank_position, top.tier
  order by top.rank_position
$$;

grant execute on function leaderboard_top(integer) to service_role;

-- 3.3 — sync_match_rating_rows : la jointure vers `players` disparaît.
--       Elle existait pour traduire le puuid en entier ; l'entier est
--       maintenant dans la ligne.
create or replace function sync_match_rating_rows()
returns integer
language plpgsql
as $$
declare
  touched integer;
  wm timestamptz;
  swept timestamptz;
  full_sweep boolean;
  started timestamptz := clock_timestamp();
begin
  insert into rating_sync_state (what) values ('match_rows') on conflict (what) do nothing;
  select watermark, full_swept_at into wm, swept
  from rating_sync_state where what = 'match_rows' for update;
  full_sweep := started - swept > interval '6 hours';

  if full_sweep then
    create temp table todo_matches on commit drop as
    select m.match_id, m.game_creation
    from matches m
    left join match_rating_rows existing on existing.match_id = m.match_id
    where m.ingested_at is not null
      and (existing.match_id is null or existing.built_at < m.ingested_at);
  else
    create temp table todo_matches on commit drop as
    select m.match_id, m.game_creation
    from matches m
    left join match_rating_rows existing on existing.match_id = m.match_id
    where m.ingested_at > wm
      and (existing.match_id is null or existing.built_at < m.ingested_at);
  end if;
  analyze todo_matches;

  insert into match_rating_rows (match_id, game_creation, players, subteams, placements, built_at)
  select
    t.match_id,
    t.game_creation,
    array_agg(p.player_id order by p.player_id),
    array_agg(p.subteam_id::smallint order by p.player_id),
    array_agg(p.placement::smallint order by p.player_id),
    now()
  from todo_matches t
  join participants_clean p on p.match_id = t.match_id
  group by t.match_id, t.game_creation
  on conflict (match_id) do update
    set game_creation = excluded.game_creation,
        players = excluded.players,
        subteams = excluded.subteams,
        placements = excluded.placements,
        built_at = excluded.built_at;
  get diagnostics touched = row_count;

  drop table todo_matches;

  update rating_sync_state
  set watermark = started - interval '2 hours',
      full_swept_at = case when full_sweep then started else full_swept_at end
  where what = 'match_rows';

  return touched;
end;
$$;

grant execute on function sync_match_rating_rows() to service_role;

-- 3.4 — sync_player_counts : le rattrapage des pseudos disparaît.
--       Il lisait `match_participants.riot_id`, colonne supprimée. Le crawler
--       écrit désormais le pseudo directement dans `players` au moment où il
--       résout le puuid en identifiant : l'information arrive à la source.
create or replace function sync_player_counts(recent_hours integer default 2)
returns integer
language plpgsql
as $$
declare
  touched integer;
  wm timestamptz;
  swept timestamptz;
  full_sweep boolean;
  started timestamptz := clock_timestamp();
begin
  insert into rating_sync_state (what) values ('player_counts') on conflict (what) do nothing;
  select watermark, full_swept_at into wm, swept
  from rating_sync_state where what = 'player_counts' for update;
  full_sweep := started - swept > interval '6 hours';

  if full_sweep then
    with compte as (
      select p as player_id, count(*) as games
      from match_rating_rows r, unnest(r.players) p
      group by p
    )
    update players pl
    set games = compte.games
    from compte
    where pl.id = compte.player_id and pl.games is distinct from compte.games;
  else
    with touched_players as materialized (
      select distinct p as player_id
      from match_rating_rows r, unnest(r.players) p
      where r.built_at > wm
    ),
    compte as (
      select p as player_id, count(*) as games
      from match_rating_rows r, unnest(r.players) p
      where p in (select player_id from touched_players)
      group by p
    )
    update players pl
    set games = compte.games
    from compte
    where pl.id = compte.player_id and pl.games is distinct from compte.games;
  end if;
  get diagnostics touched = row_count;

  update rating_sync_state
  set watermark = started - interval '2 hours',
      full_swept_at = case when full_sweep then started else full_swept_at end
  where what = 'player_counts';

  return touched;
end;
$$;

grant execute on function sync_player_counts(integer) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- APRÈS : dis-le moi, je prends la suite
-- ════════════════════════════════════════════════════════════════════════════
--
-- Il restera à fusionner la branche `compression-participations` (le code qui
-- lit `player_id`), republier, et relancer le moteur. Je m'en charge — et je
-- vérifie d'abord que l'échange a bien pris, en lecture seule.
--
-- Entre l'échange et la fusion, le site sert ses pages en cache mais les pages
-- de joueur et le job de recalcul échouent : le code déployé cherche encore un
-- `puuid` qui n'existe plus. C'est une fenêtre de deux à trois minutes, le
-- temps du build Vercel.
