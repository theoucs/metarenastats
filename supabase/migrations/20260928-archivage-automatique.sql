-- ════════════════════════════════════════════════════════════════════════════
-- ARCHIVAGE AUTOMATIQUE ET ADDITIF — 2026-09-28
-- ════════════════════════════════════════════════════════════════════════════
--
-- Remplace roll_up_patch + drop_patch_participations (20260922-retention-et-rollup.sql).
--
-- ─── CE QUI N'ALLAIT PAS ────────────────────────────────────────────────────
--
-- 1. L'archivage était manuel. Le 16.18 serait sorti de la fenêtre sans que
--    personne ne le résume : ~500 000 participations gardées pour rien, et
--    ainsi à chaque patch.
-- 2. roll_up_patch REMPLAÇAIT les compteurs d'un patch par ce qu'il trouvait.
--    Or le crawler continue de ramener des matchs de patchs déjà archivés
--    (263 000 participations au 28/09) : relancer l'archivage sur ces patchs
--    aurait écrasé l'archive par ces seuls retardataires.
-- 3. Rien ne disait QUELS matchs étaient archivés. Une recherche de joueur
--    réécrit tous les matchs qu'elle lit : un match déjà résumé pouvait
--    retrouver ses participations, et être compté deux fois.
--    Vérifié le 28/09 : ce n'est pas encore arrivé — archive + brut = matchs
--    × 18, au déficit AFK près (0,18 % sur 16.17, 0,20 % mesuré sur 16.18).
--
-- ─── LA FORME ───────────────────────────────────────────────────────────────
--
-- L'unité d'archivage devient le MATCH, pas le patch. `matches.archived_at`
-- dit qu'un match est résumé ; l'archivage ADDITIONNE ses compteurs, supprime
-- ses participations et le marque, dans une seule instruction. Un match ne
-- peut donc être compté qu'une fois, qu'il arrive avant ou après la bascule.
--
-- Suppression et comptage dans LA MÊME instruction (`delete … returning`) :
-- en deux instructions, une participation écrite entre les deux serait
-- supprimée sans avoir été comptée.
--
-- Un match n'est archivé que si sa ligne de classement est construite et à
-- jour : `match_rating_rows` se construit DEPUIS les participations, et le
-- MMR rejoue tout l'historique à chaque passe.

-- ── 1. Le marqueur ──────────────────────────────────────────────────────────
alter table matches add column if not exists archived_at timestamptz;

-- Les matchs résumés le 24/09 : patch archivé ET plus aucune participation.
-- Ceux qui en ont encore sont les retardataires, jamais comptés — vérifié
-- ci-dessus — et restent à NULL pour que le premier passage les ramasse.
update matches m
set archived_at = r.rolled_at
from rolled_patches r
where m.patch = r.patch
  and m.archived_at is null
  and not exists (select 1 from match_participants p where p.match_id = m.match_id);

-- ── 2. L'archivage ──────────────────────────────────────────────────────────
create or replace function archive_old_matches(max_matches integer)
returns integer
language plpgsql
security definer
set search_path = public
set work_mem = '64MB'
set statement_timeout = '280s'
as $$
declare
  archived integer;
begin
  -- `on commit drop` ne suffit pas : deux appels dans une même transaction
  -- retrouveraient les tables du premier.
  drop table if exists pg_temp.published, pg_temp.batch;

  -- Les deux publiés : même règle que patch_options() et que le site.
  create temp table published on commit drop as
  select m.patch
  from matches m
  where m.patch is not null and m.ingested_at is not null
  group by m.patch
  having count(*) >= 5
  order by string_to_array(m.patch, '.')::int[] desc
  limit 2;

  -- Garde-fou : sans deux patchs publiés connus, on ne sait pas ce qui est
  -- vieux. Mieux vaut ne rien archiver que tout archiver.
  if (select count(*) from published) < 2 then
    return 0;
  end if;

  create temp table batch on commit drop as
  select m.match_id, m.patch
  from matches m
  join match_rating_rows r on r.match_id = m.match_id and r.built_at >= m.ingested_at
  where m.archived_at is null
    and m.ingested_at is not null
    and m.patch is not null
    and m.patch not in (select patch from published)
  limit max_matches;

  if not exists (select 1 from batch) then
    return 0;
  end if;

  with gone as (
    delete from match_participants p
    using batch b
    where p.match_id = b.match_id
    returning p.match_id, p.player_id, p.subteam_id, p.placement, p.champion, p.items
  ),
  -- Même exclusion que la vue participants_clean : une équipe dont un membre
  -- porte un objet AFK ne compte pas. Calculable sur `gone` seul, puisque
  -- toutes les participations d'un match partent ensemble.
  afk as (
    select distinct match_id, subteam_id
    from gone
    where items && array[220008, 220009, 220010, 220011]
  ),
  counted as (
    select g.player_id, g.champion, b.patch,
           count(*) as games,
           count(*) filter (where g.placement = 1) as top1,
           count(*) filter (where g.placement <= 3) as top3,
           sum(g.placement) as placement_sum
    from gone g
    join batch b on b.match_id = g.match_id
    where not exists (
      select 1 from afk a where a.match_id = g.match_id and a.subteam_id = g.subteam_id
    )
    group by g.player_id, g.champion, b.patch
  ),
  written as (
    insert into player_champion_totals (player_id, champion, patch, games, top1_wins, top3_wins, placement_sum)
    select player_id, champion, patch, games, top1, top3, placement_sum from counted
    on conflict (player_id, champion, patch) do update
      set games         = player_champion_totals.games         + excluded.games,
          top1_wins     = player_champion_totals.top1_wins     + excluded.top1_wins,
          top3_wins     = player_champion_totals.top3_wins     + excluded.top3_wins,
          placement_sum = player_champion_totals.placement_sum + excluded.placement_sum
    returning patch
  ),
  per_patch as (
    select c.patch, sum(c.games) as participations,
           (select count(*) from written w where w.patch = c.patch) as rows_written
    from counted c
    group by c.patch
  )
  insert into rolled_patches (patch, participations, rows_written)
  select patch, participations, rows_written from per_patch
  on conflict (patch) do update
    set rolled_at      = now(),
        participations = rolled_patches.participations + excluded.participations,
        rows_written   = rolled_patches.rows_written   + excluded.rows_written;

  update matches m set archived_at = now()
  from batch b where m.match_id = b.match_id;
  get diagnostics archived = row_count;

  return archived;
end;
$$;

grant execute on function archive_old_matches(integer) to service_role;

-- ── 3. Les anciennes fonctions ──────────────────────────────────────────────
-- Supprimées plutôt que gardées « au cas où » : roll_up_patch écraserait
-- désormais une archive additive, et c'est exactement l'erreur qu'on corrige.
drop function if exists roll_up_patch(text);
drop function if exists drop_patch_participations(text);
