-- ════════════════════════════════════════════════════════════════════════════
-- RÉTENTION DES PARTICIPATIONS BRUTES + ROLLUP DE CARRIÈRE — 2026-09-22
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️  À N'APPLIQUER QU'APRÈS 20260922-compression-participations.sql, dont
--     cette migration suppose la forme (`player_id` au lieu de `puuid`).
--
-- ─── CE QUE LES VIEILLES PARTICIPATIONS SERVENT VRAIMENT ────────────────────
--
-- Vérifié lecteur par lecteur le 2026-09-22, et la réponse est : presque rien.
--
--   le classement            lit `match_rating_rows` — 27 Mo pour 72 000 matchs,
--                            une ligne par match, pas par participation. Et
--                            sync_match_rating_rows() ne reconstruit une ligne
--                            que si le match a été RÉINGÉRÉ : supprimer les
--                            participations ne la détruit pas.
--   le compteur de parties   lit `match_rating_rows` aussi.
--   les derniers matchs      viennent de l'API Riot en direct, pas de la base.
--   les tier lists           ne lisent que les deux patchs publiés, par
--                            construction (participants_published).
--
--   getPlayerProfile()       SEUL lecteur de tout l'historique. Et il n'utilise
--                            que DEUX champs : `champion` et `placement`.
--
-- Une carrière de joueur tient donc dans une ligne par (joueur, champion) :
-- ~40 octets là où les participations brutes en coûtent 184 même compressées.
--
-- ─── POURQUOI C'EST NÉCESSAIRE ET PAS SEULEMENT CONFORTABLE ─────────────────
--
-- À ~14 000 matchs par jour, un patch de quatorze jours finira par représenter
-- ~200 000 matchs, soit 3,6 M de participations. Deux patchs publiés = 7 M de
-- lignes. Sans rétention, la table garde en plus TOUT l'historique — qui n'a
-- aucun lecteur au-delà du rollup.
--
-- Ce n'est pas la fin de l'histoire : 7 M de lignes dépassent de loin le
-- plafond de lecture de l'agrégation en JS (MAX_PAGES × PAGE_SIZE = 600 000,
-- déjà à 380 000 sur le patch 16.17). La rétention borne le STOCKAGE ; elle ne
-- dispense pas de l'agrégation en SQL.

-- ════════════════════════════════════════════════════════════════════════════
-- 1 — La table de carrière
-- ════════════════════════════════════════════════════════════════════════════
--
-- Les compteurs bruts, pas des moyennes : une moyenne ne s'additionne pas.
-- `placement_sum` plus `games` permettent de recombiner le rollup avec les
-- participations encore vivantes ; une moyenne pré-calculée ne le permettrait
-- pas, et c'est exactement ce dont la page d'un joueur a besoin.
--
-- `patch` reste dans la clé : sans lui, on ne saurait pas quels patchs ont
-- déjà été roulés, et un second passage compterait deux fois. Avec lui, le
-- rollup est idempotent — c'est la propriété qui compte pour un job qui peut
-- être rejoué après un échec.
create table if not exists player_champion_totals (
  player_id     integer  not null references players (id),
  champion      text     not null,
  patch         text     not null,
  games         integer  not null,
  top1_wins     integer  not null,
  top3_wins     integer  not null,
  placement_sum integer  not null,
  rolled_at     timestamptz not null default now(),
  primary key (player_id, champion, patch)
);

create index if not exists player_champion_totals_player_idx
  on player_champion_totals (player_id);

grant select, insert, update, delete on player_champion_totals to service_role;

-- Quels patchs ont déjà été archivés. Une table plutôt qu'un `distinct` sur
-- player_champion_totals : un patch où personne n'aurait joué (impossible en
-- pratique, mais le code ne doit pas en dépendre) y figure quand même, et la
-- lecture coûte une ligne au lieu d'un parcours.
create table if not exists rolled_patches (
  patch      text primary key,
  rolled_at  timestamptz not null default now(),
  -- Ce que l'archivage a résumé, pour pouvoir vérifier après coup.
  participations integer not null,
  rows_written   integer not null
);

grant select, insert, update, delete on rolled_patches to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 — Archiver un patch, puis le supprimer
-- ════════════════════════════════════════════════════════════════════════════
--
-- Deux fonctions et non une. L'archivage écrit, la suppression détruit : les
-- séparer permet de lancer le premier, de VÉRIFIER, et de ne lancer le second
-- que si le compte est bon. Une seule fonction qui ferait les deux ne
-- laisserait aucun moment pour regarder.

-- 2.1 — Résume un patch dans player_champion_totals. Idempotent.
create or replace function roll_up_patch(target_patch text)
returns integer
language plpgsql
security definer
set search_path = public
set work_mem = '64MB'
set statement_timeout = '600s'
as $$
declare
  written integer;
  seen integer;
begin
  -- `participants_clean` et non la table brute : le rollup doit appliquer les
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
        placement_sum = excluded.placement_sum,
        rolled_at     = now();
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
$$;

grant execute on function roll_up_patch(text) to service_role;

-- 2.2 — Supprime les participations brutes d'un patch DÉJÀ archivé.
--
-- Refuse de supprimer un patch qui n'a pas été résumé, et refuse de toucher
-- aux deux patchs publiés. Les deux gardes sont dans la fonction et non dans
-- l'appelant : c'est la seule place où on ne peut pas les oublier.
create or replace function drop_patch_participations(target_patch text)
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '600s'
as $$
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
$$;

grant execute on function drop_patch_participations(text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 — Le premier passage, à la main
-- ════════════════════════════════════════════════════════════════════════════
--
-- Les patchs publiés au 2026-09-22 sont 16.18 et 16.17. Tout ce qui précède
-- peut être archivé. Un patch à la fois, en vérifiant entre chaque — c'est une
-- suppression, elle ne se reprend pas.
--
--   select roll_up_patch('16.10');
--   -- vérifier : les deux comptes doivent concorder
--   select participations, rows_written from rolled_patches where patch = '16.10';
--   select drop_patch_participations('16.10');
--
-- Puis 16.11, 16.12, 16.13, 16.14, 16.15, 16.16.
--
-- Répartition des matchs au 2026-09-22 :
--   16.18  14 793   publié
--   16.17  21 106   publié
--   16.16  12 107   archivable
--   16.15   8 868
--   16.14   6 007
--   16.13   6 737
--   16.12   2 103
--   16.11   1 601
--   16.10   1 076
--   (null)    595   ← matchs sans patch : voir plus bas
--
-- 38 499 matchs archivables, soit ~693 000 participations : plus de la moitié
-- de la table.
--
-- LES 595 MATCHS SANS PATCH ne sont couverts par aucune des deux fonctions
-- (`p.patch = target_patch` ne rattrape pas NULL). C'est volontaire : un match
-- sans patch est un défaut d'ingestion, pas une donnée périmée. À traiter
-- séparément — `scripts/find-patch-boundaries.mjs` sait les dater.

-- ════════════════════════════════════════════════════════════════════════════
-- 4 — Ensuite, automatiquement
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un patch qui sort de la fenêtre des deux publiés devient archivable. Le job
-- horaire connaît déjà cette fenêtre (`patch_options`), donc il sait aussi ce
-- qui vient d'en sortir :
--
--   archiver puis supprimer tout patch qui a des participations, qui n'est pas
--   dans les deux publiés, et qui n'est pas déjà dans rolled_patches
--
-- À câbler côté application dans la phase `?only=ratings` — elle a de la marge,
-- là où la publication n'en a pas. Et une seule fois par bascule de patch,
-- toutes les deux semaines : la détection coûte une lecture de rolled_patches.
--
-- Pas fait dans cette migration : le premier passage manuel doit avoir eu lieu
-- et avoir été vérifié avant qu'on laisse un job supprimer des lignes tout seul.
