-- ════════════════════════════════════════════════════════════════════════════
-- FONCTIONS SQL — FICHIER VIDÉ DEPUIS LA BASE, NE PAS MODIFIER À LA MAIN
-- ════════════════════════════════════════════════════════════════════════════
--
-- Produit par scripts/dump-sql-functions.mjs. La vérité est la base ; ce
-- fichier en est une photographie, prise pour que le dépôt puisse la
-- reconstruire et pour que les revues de code voient ce qui a changé.
--
-- Pour modifier une de ces fonctions : écrire une migration, l'appliquer, puis
-- relancer le script. Éditer ce fichier ne changerait rien à la base.
--
-- Vidé le 2026-09-25.

CREATE OR REPLACE FUNCTION public.anvil_champions(target_patch text)
 RETURNS TABLE(champion text, games bigint, top1_wins bigint, top3_wins bigint, placement_sum bigint, total_games bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with libres as (
    select array_agg(id) as ids from ref_items where category in ('prismatic', 'excluded')
  ),
  lignes as (
    select p.champion, p.placement, p.items <@ (select ids from libres) as anvil
    from participants_published p
    where p.patch = target_patch
  )
  select
    l.champion,
    count(*) filter (where l.anvil),
    count(*) filter (where l.anvil and l.placement = 1),
    count(*) filter (where l.anvil and l.placement <= 3),
    coalesce(sum(l.placement) filter (where l.anvil), 0)::bigint,
    -- Le dénominateur du taux de sélection est « les parties de ce champion,
    -- TOUS styles confondus » : la colonne répond « quelle part de ses parties
    -- sont des anvil runs », pas « quelle part des anvil runs sont les
    -- siennes ». C'est le même chiffre que l'onglet enclume d'un champion.
    count(*)
  from lignes l
  group by l.champion
  having count(*) filter (where l.anvil) > 0
$function$
;

CREATE OR REPLACE FUNCTION public.anvil_opener_champions(target_patch text, opener_ids integer[], min_games integer)
 RETURNS TABLE(augment_id integer, champion text, games bigint, top1_wins bigint, top3_wins bigint, placement_sum bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with libres as (
    select array_agg(id) as ids from ref_items where category in ('prismatic', 'excluded')
  )
  select
    p.augments[1],
    p.champion,
    count(*),
    count(*) filter (where p.placement = 1),
    count(*) filter (where p.placement <= 3),
    sum(p.placement)::bigint
  from participants_published p
  where p.patch = target_patch
    and p.augments[1] = any(opener_ids)
    and p.items <@ (select ids from libres)
  group by p.augments[1], p.champion
  having count(*) >= min_games
$function$
;

CREATE OR REPLACE FUNCTION public.anvil_openers(target_patch text, opener_ids integer[])
 RETURNS TABLE(augment_id integer, anvil_games bigint, anvil_top1 bigint, anvil_top3 bigint, anvil_placement_sum bigint, bought_games bigint, bought_top1 bigint, bought_top3 bigint, bought_placement_sum bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with libres as (
    select array_agg(id) as ids from ref_items where category in ('prismatic', 'excluded')
  ),
  lignes as (
    select p.augments[1] as opener, p.placement,
           p.items <@ (select ids from libres) as anvil
    from participants_published p
    where p.patch = target_patch and p.augments[1] = any(opener_ids)
  )
  select
    l.opener,
    count(*) filter (where l.anvil),
    count(*) filter (where l.anvil and l.placement = 1),
    count(*) filter (where l.anvil and l.placement <= 3),
    coalesce(sum(l.placement) filter (where l.anvil), 0)::bigint,
    count(*) filter (where not l.anvil),
    count(*) filter (where not l.anvil and l.placement = 1),
    count(*) filter (where not l.anvil and l.placement <= 3),
    coalesce(sum(l.placement) filter (where not l.anvil), 0)::bigint
  from lignes l
  group by l.opener
$function$
;

CREATE OR REPLACE FUNCTION public.anvil_overall(target_patch text)
 RETURNS TABLE(total_matches bigint, games bigint, top1_wins bigint, top3_wins bigint, placement_sum bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with libres as (
    select array_agg(id) as ids from ref_items where category in ('prismatic', 'excluded')
  ),
  anvil as (
    select p.match_id, p.placement
    from participants_published p
    where p.patch = target_patch and p.items <@ (select ids from libres)
  )
  select
    count(distinct a.match_id),
    count(*),
    count(*) filter (where a.placement = 1),
    count(*) filter (where a.placement <= 3),
    coalesce(sum(a.placement), 0)::bigint
  from anvil a
$function$
;

CREATE OR REPLACE FUNCTION public.augment_stats(target_patch text)
 RETURNS TABLE(augment_id integer, games bigint, top1_wins bigint, top3_wins bigint, placement_sum bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    a.augment_id,
    count(*),
    count(*) filter (where a.placement = 1),
    count(*) filter (where a.placement <= 3),
    sum(a.placement)::bigint
  from (
    select unnest(p.augments) as augment_id, p.placement
    from participants_published p
    where p.patch = target_patch
  ) a
  where not exists (
    select 1 from ref_augments r
    where r.id = a.augment_id and r.category = 'excluded'
  )
  group by a.augment_id
$function$
;

CREATE OR REPLACE FUNCTION public.augment_timing(target_patch text, slots integer)
 RETURNS TABLE(slot integer, augment_id integer, games bigint, top1_wins bigint, top3_wins bigint, placement_sum bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with picks as (
    select
      a.augment_id,
      p.placement,
      row_number() over (
        partition by p.match_id, p.player_id
        order by a.ord
      )::integer as slot
    from participants_published p
    cross join lateral unnest(p.augments) with ordinality as a(augment_id, ord)
    where p.patch = target_patch
      and not exists (
        select 1 from ref_augments r
        where r.id = a.augment_id and r.category = 'excluded'
      )
  )
  select
    k.slot,
    k.augment_id,
    count(*),
    count(*) filter (where k.placement = 1),
    count(*) filter (where k.placement <= 3),
    sum(k.placement)::bigint
  from picks k
  where k.slot <= slots
  group by k.slot, k.augment_id
$function$
;

CREATE OR REPLACE FUNCTION public.champion_stats(target_patch text)
 RETURNS TABLE(champion text, games bigint, top1_wins bigint, top3_wins bigint, placement_sum bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    p.champion,
    count(*),
    count(*) filter (where p.placement = 1),
    count(*) filter (where p.placement <= 3),
    sum(p.placement)::bigint
  from participants_published p
  where p.patch = target_patch
  group by p.champion
$function$
;

CREATE OR REPLACE FUNCTION public.combo_stats(target_patch text, min_games integer)
 RETURNS TABLE(a integer, b integer, games bigint, top1_wins bigint, top3_wins bigint, placement_sum bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '96MB'
AS $function$
  with choix as (
    select p.match_id, p.player_id, p.placement,
           coalesce(rb.canonical_id, u.id) as code
    from participants_published p
    cross join lateral unnest(p.items) as u(id)
    left join ref_items rb on rb.id = u.id
    left join ref_items rc on rc.id = coalesce(rb.canonical_id, u.id)
    where p.patch = target_patch
      and rc.category is distinct from 'excluded'
      and rc.category is distinct from 'boots'
    union all
    select p.match_id, p.player_id, p.placement, 4194304 + a.id
    from participants_published p
    cross join lateral unnest(p.augments) as a(id)
    where p.patch = target_patch
      and not exists (
        select 1 from ref_augments r
        where r.id = a.id and r.category = 'excluded'
      )
  ),
  paires as (
    select
      x.code::bigint * 8388608 + y.code as cle,
      x.placement
    from choix x
    join choix y
      on y.match_id = x.match_id
     and y.player_id = x.player_id
     and y.code > x.code
  )
  select
    (p.cle / 8388608)::integer,
    (p.cle % 8388608)::integer,
    count(*),
    count(*) filter (where p.placement = 1),
    count(*) filter (where p.placement <= 3),
    sum(p.placement)::bigint
  from paires p
  group by p.cle
  having count(*) >= min_games
$function$
;

CREATE OR REPLACE FUNCTION public.combo_stats_probe(target_patch text, min_games integer)
 RETURNS TABLE(paires bigint, occurrences bigint, ms integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '600s'
AS $function$
declare
  t0 timestamptz := clock_timestamp();
  n bigint;
  occ bigint;
begin
  select count(*), coalesce(sum(games), 0) into n, occ
  from combo_stats(target_patch, min_games);
  return query select n, occ, (extract(epoch from clock_timestamp() - t0) * 1000)::integer;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.comp_archetypes(target_patch text, min_teams integer)
 RETURNS TABLE(roles text[], games bigint, top1_wins bigint, top3_wins bigint, placement_sum bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with equipes as (
    select
      p.match_id,
      p.subteam_id,
      min(p.placement) as placement,
      count(*) as membres,
      count(rc.role) as roles_connus,
      array_agg(rc.role order by rc.role) filter (where rc.role is not null) as roles
    from participants_published p
    left join ref_champions rc on lower(rc.id) = lower(p.champion)
    where p.patch = target_patch
    group by p.match_id, p.subteam_id
  )
  select
    e.roles,
    count(*),
    count(*) filter (where e.placement = 1),
    count(*) filter (where e.placement <= 3),
    sum(e.placement)::bigint
  from equipes e
  where e.membres = 3 and e.roles_connus = 3
  group by e.roles
  having count(*) >= min_teams
$function$
;

CREATE OR REPLACE FUNCTION public.comp_coverage(target_patch text, duo_usable_teams integer)
 RETURNS TABLE(total_teams bigint, trios_distincts bigint, trios_repetes bigint, duos_distincts bigint, duos_exploitables bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with equipes as (
    select
      p.match_id,
      p.subteam_id,
      count(*) as membres,
      array_agg(p.champion order by p.champion) as champions
    from participants_published p
    where p.patch = target_patch
    group by p.match_id, p.subteam_id
  ),
  valides as (
    select champions from equipes where membres = 3
  ),
  trios as (
    select champions, count(*) as n from valides group by champions
  ),
  duos as (
    -- Les trois paires d'une équipe de trois : (1,2), (1,3), (2,3). Les indices
    -- portent sur un tableau DÉJÀ TRIÉ, donc chaque paire sort dans un ordre
    -- unique et « Ahri+Zed » ne peut pas compter séparément de « Zed+Ahri ».
    select champions[i] as a, champions[j] as b, count(*) as n
    from valides, generate_series(1, 3) i, generate_series(1, 3) j
    where i < j
    group by champions[i], champions[j]
  )
  select
    (select count(*) from valides),
    (select count(*) from trios),
    (select count(*) from trios where n > 1),
    (select count(*) from duos),
    (select count(*) from duos where n >= duo_usable_teams)
$function$
;

CREATE OR REPLACE FUNCTION public.drop_patch_participations(target_patch text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '600s'
AS $function$
declare
  removed integer;
begin
  if not exists (select 1 from rolled_patches where patch = target_patch) then
    raise exception 'Patch % non archivé — lancer roll_up_patch(%) d''abord.',
      target_patch, target_patch;
  end if;

  if target_patch in (
    select m.patch
    from matches m
    where m.patch is not null and m.ingested_at is not null
    group by m.patch
    having count(*) >= 5
    order by string_to_array(m.patch, '.')::int[] desc
    limit 2
  ) then
    raise exception 'Patch % est publié — le site le lit, on n''y touche pas.',
      target_patch;
  end if;

  delete from match_participants p
  using matches m
  where m.match_id = p.match_id and m.patch = target_patch;
  get diagnostics removed = row_count;

  return removed;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dump_aggregation_functions()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select string_agg(pg_get_functiondef(p.oid), E';\n\n' order by p.proname) || ';'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.deptype = 'e'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.item_acquisitions(target_patch text)
 RETURNS TABLE(item_id integer, kind text, landmark integer, skill_bucket smallint, n bigint, placement_sum bigint, top1_wins bigint, top3_wins bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with prismatiques as (
    select coalesce(array_agg(id), '{}'::integer[]) as ids
    from ref_items where category = 'prismatic'
  ),
  acquisitions as (
    select
      coalesce(rb.canonical_id, u.id) as item_id,
      case when rc.category = 'prismatic' then 'prismatic' else 'bought' end as kind,
      case
        when rc.category = 'prismatic' then pc.n
        else coalesce(
               array_position(p.item_order, coalesce(rb.canonical_id, u.id)),
               array_position(p.item_order, u.id)
             )::integer
      end as landmark,
      p.skill_bucket,
      p.placement
    from participants_published p
    cross join prismatiques pr
    cross join lateral (
      select count(*)::integer as n
      from unnest(p.items) as x(id)
      where x.id = any (pr.ids)
    ) pc
    cross join lateral unnest(p.items) as u(id)
    left join ref_items rb on rb.id = u.id
    left join ref_items rc on rc.id = coalesce(rb.canonical_id, u.id)
    where p.patch = target_patch
      and rc.category is distinct from 'excluded'
  )
  select
    a.item_id,
    a.kind,
    a.landmark,
    a.skill_bucket,
    count(*),
    sum(a.placement)::bigint,
    count(*) filter (where a.placement = 1),
    count(*) filter (where a.placement <= 3)
  from acquisitions a
  group by a.item_id, a.kind, a.landmark, a.skill_bucket
$function$
;

CREATE OR REPLACE FUNCTION public.landmark_baselines(target_patch text)
 RETURNS TABLE(kind text, landmark integer, skill_bucket smallint, n bigint, placement_sum bigint, top1_wins bigint, top3_wins bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with prismatiques as (
    select coalesce(array_agg(id), '{}'::integer[]) as ids
    from ref_items where category = 'prismatic'
  ),
  acquisitions as (
    select
      case when rc.category = 'prismatic' then 'prismatic' else 'bought' end as kind,
      case
        when rc.category = 'prismatic' then pc.n
        else coalesce(
               array_position(p.item_order, coalesce(rb.canonical_id, u.id)),
               array_position(p.item_order, u.id)
             )::integer
      end as landmark,
      p.skill_bucket,
      p.placement
    from participants_published p
    cross join prismatiques pr
    cross join lateral (
      select count(*)::integer as n
      from unnest(p.items) as x(id)
      where x.id = any (pr.ids)
    ) pc
    cross join lateral unnest(p.items) as u(id)
    -- La forme de base de l'item tenu…
    left join ref_items rb on rb.id = u.id
    -- …puis la catégorie de CETTE forme de base, qui est celle que
    -- `categoryOf` lit côté app, les formes évoluées y étant déjà fusionnées.
    left join ref_items rc on rc.id = coalesce(rb.canonical_id, u.id)
    where p.patch = target_patch
      and rc.category is distinct from 'excluded'
  )
  select
    a.kind,
    a.landmark,
    a.skill_bucket,
    count(*),
    sum(a.placement)::bigint,
    count(*) filter (where a.placement = 1),
    count(*) filter (where a.placement <= 3)
  from acquisitions a
  where a.landmark is not null
  group by a.kind, a.landmark, a.skill_bucket
$function$
;

CREATE OR REPLACE FUNCTION public.leaderboard_top(max_rows integer)
 RETURNS TABLE(puuid text, riot_id text, games bigint, top3_wins bigint, top1_wins bigint, placement_sum bigint, rank_position integer, tier text)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.patch_match_count(target_patch text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
AS $function$
  select count(distinct p.match_id)::bigint
  from participants_published p
  where p.patch = target_patch
$function$
;

CREATE OR REPLACE FUNCTION public.patch_options(min_matches integer DEFAULT 5)
 RETURNS TABLE(patch text, matches bigint, newest timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  select m.patch,
         count(*) as matches,
         max(m.game_creation) as newest
  from matches m
  where m.patch is not null and m.ingested_at is not null
  group by m.patch
  having count(*) >= min_matches
  order by string_to_array(m.patch, '.')::int[] desc
$function$
;

CREATE OR REPLACE FUNCTION public.promote_tracked_players(min_games integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '64MB'
AS $function$
declare
  promoted integer;
begin
  -- Le RÉSULTAT est minuscule (quelques dizaines de joueurs par heure), le
  -- CHEMIN ne l'était pas : une jointure complète entre crawl_queue (230 000
  -- lignes, clée sur un puuid de 79 octets) et players (245 000), dont la table
  -- de hachage ne tient pas dans les 2,1 Mo de work_mem d'une instance Micro et
  -- débordait sur disque — 166 s mesurées le 2026-09-22, puis dépassement du
  -- délai.
  --
  -- `materialized` force l'ordre : les ~67 000 joueurs à trois parties d'abord,
  -- par players_games_idx, puis une sonde sur la clé primaire de crawl_queue.
  -- Sans lui, le planificateur aplatit le CTE et retombe sur la jointure.
  with candidats as materialized (
    select pl.puuid
    from players pl
    where pl.games >= min_games
  )
  update crawl_queue q
  set priority = 1
  from candidats c
  where q.puuid = c.puuid
    and q.priority = 0;
  get diagnostics promoted = row_count;
  return promoted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rating_matches(after_created timestamp with time zone DEFAULT '-infinity'::timestamp with time zone, after_match text DEFAULT ''::text, page_size integer DEFAULT 1000)
 RETURNS TABLE(game_creation timestamp with time zone, match_id text, players integer[], subteams smallint[], placements smallint[])
 LANGUAGE sql
 STABLE
AS $function$
  select r.game_creation, r.match_id, r.players, r.subteams, r.placements
  from match_rating_rows r
  where (r.game_creation, r.match_id) > (after_created, after_match)
  order by r.game_creation, r.match_id
  limit page_size
$function$
;

CREATE OR REPLACE FUNCTION public.rating_players(min_games integer, after_idx integer DEFAULT 0, page_size integer DEFAULT 1000)
 RETURNS TABLE(player_idx integer, puuid text, riot_id text, games bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select pl.id::integer, pl.puuid, coalesce(pl.riot_id, pl.puuid), pl.games::bigint
  from players pl
  where pl.games >= min_games and pl.id > after_idx
  order by pl.id
  limit page_size
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_published_participants()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '180s'
AS $function$
begin
  refresh materialized view concurrently participants_published;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.roll_up_patch(target_patch text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '64MB'
 SET statement_timeout TO '600s'
AS $function$
declare
  written integer;
  seen integer;
begin
  -- `participants_clean` et non la table brute : l'archive doit appliquer les
  -- mêmes exclusions que les tier lists (équipes AFK), sinon la carrière d'un
  -- joueur compterait des parties que le reste du site ne compte pas.
  insert into player_champion_totals (
    player_id, champion, patch, games, top1_wins, top3_wins, placement_sum
  )
  select
    p.player_id,
    p.champion,
    target_patch,
    count(*),
    count(*) filter (where p.placement = 1),
    count(*) filter (where p.placement <= 3),
    sum(p.placement)
  from participants_clean p
  where p.patch = target_patch
  group by p.player_id, p.champion
  on conflict (player_id, champion, patch) do update
    set games         = excluded.games,
        top1_wins     = excluded.top1_wins,
        top3_wins     = excluded.top3_wins,
        placement_sum = excluded.placement_sum;
  get diagnostics written = row_count;

  select count(*) into seen from participants_clean where patch = target_patch;

  insert into rolled_patches (patch, participations, rows_written)
  values (target_patch, seen, written)
  on conflict (patch) do update
    set rolled_at = now(),
        participations = excluded.participations,
        rows_written = excluded.rows_written;

  return written;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.site_totals()
 RETURNS TABLE(total_matches bigint, total_champions bigint, total_players bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    (select count(*) from matches where ingested_at is not null),
    (select count(distinct champion) from match_participants),
    (select count(*) from players)
$function$
;

CREATE OR REPLACE FUNCTION public.sync_match_rating_rows()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_player_counts(recent_hours integer DEFAULT 2)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_players()
 RETURNS integer
 LANGUAGE sql
AS $function$
  select 0;
$function$
;
