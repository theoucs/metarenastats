-- ════════════════════════════════════════════════════════════════════════════
-- COMPRESSION DE match_participants — 2026-09-22
-- ════════════════════════════════════════════════════════════════════════════
--
-- Pourquoi. La table pèse 720 Mo sur une base de 1 218 Mo — 59 % à elle seule —
-- et le disque est plein depuis ce matin : le rafraîchissement de la table
-- matérialisée n'a plus où écrire ses fichiers temporaires, donc plus rien ne
-- se publie.
--
-- Mesuré au 2026-09-22 sur 20 000 lignes (`pg_column_size`), une participation
-- pèse 322 octets, dont :
--
--   puuid (texte)   79      ← alors que `players` fait DÉJÀ la correspondance
--   items           45          puuid → id, et que `match_rating_rows` utilise
--   augments        37          déjà `players.id::integer`
--   item_order      31
--   match_id        16
--   riot_id         15      ← copie de `players.riot_id`, qui se périme
--   champion         7
--   le reste        92      ← dont un `id` bigint que rien ne lit
--
-- Ce puuid coûte 102 Mo de données, et il est la raison pour laquelle
-- `match_participants_match_id_puuid_key` pèse 208 Mo : le plus gros objet de
-- toute la base.
--
-- Ce que la migration fait, et ce qu'elle ne fait pas.
--
--   FAIT       puuid text → player_id integer
--   FAIT       supprime riot_id (personne ne le lit ; le pseudo vit dans players)
--   FAIT       supprime l'id bigint et son index (0 lecture) — la clé primaire
--              devient (match_id, player_id), qui est celle dont l'upsert a
--              besoin : un index au lieu de deux
--   FAIT       supprime created_at (aucun lecteur dans le code)
--   FAIT       les cinq entiers passent en smallint
--
--   PAS FAIT   match_id texte → entier (~15 Mo) : touche la clé étrangère, le
--              crawler, le fetcheur de timelines. Gain modeste, risque large.
--   PAS FAIT   champion texte → smallint (~7 Mo) : demanderait une table de
--              correspondance, donc une base qui ne se décrit plus toute seule.
--   PAS FAIT   crawl_queue clée par puuid (~48 Mo) : le crawler a besoin du
--              puuid en clair pour appeler Riot, donc une jointure en plus dans
--              sa boucle principale. À faire séparément, pas la veille d'une
--              bascule de patch.
--
-- Les deux premières lignes du bilan portent 90 % du gain pour 20 % du risque.
--
-- Estimation, à 1 290 468 lignes :
--
--                    avant      après
--   octets/ligne       322        184
--   données         413 Mo     237 Mo
--   index           307 Mo      67 Mo     (une PK de 46 Mo + player_id 21 Mo)
--   ─────────────────────────────────────
--   total           720 Mo     304 Mo     → ~415 Mo rendus
--
-- Et la ligne rétrécit d'un tiers, donc la CROISSANCE ralentit d'autant : à
-- ~250 000 participations par jour, ~140 Mo/jour deviennent ~80 Mo/jour.
--
-- ─── COMMENT L'EXÉCUTER ─────────────────────────────────────────────────────
--
-- Phase par phase, en vérifiant chacune. Ce n'est pas un script à lancer d'un
-- bloc : la phase 2 réécrit 1,3 M de lignes et la phase 3 échange les tables.
--
-- PRÉREQUIS
--   1. Supabase en plan Pro. La phase 2 fait coexister l'ancienne table et la
--      nouvelle — il faut ~1 Go de disque libre, qu'on n'a pas en Free.
--   2. Le moteur de crawl à l'ARRÊT pendant les phases 2 et 3, sinon il écrit
--      dans une table qu'on est en train de remplacer :
--        gh run list --workflow=engine.yml   puis   gh run cancel <id>
--   3. Le code applicatif correspondant est prêt sur la branche
--      `compression-participations`, mais NE DOIT ÊTRE FUSIONNÉ QU'APRÈS la
--      phase 3 : il lit `player_id`, qui n'existe pas avant.
--
-- ORDRE : phase 1 → 2 → 3 → 4, puis fusionner la branche, puis phase 5.

-- ════════════════════════════════════════════════════════════════════════════
-- PHASE 1 — Mettre `players` en état de servir de référence
-- ════════════════════════════════════════════════════════════════════════════
--
-- Deux choses à garantir avant de pouvoir pointer vers `players` :
-- que toute participation ait un joueur, et que le pseudo soit sauvé avant que
-- la colonne qui le porte disparaisse.

-- 1.1 — Tout puuid vu en partie a une ligne `players`.
--
-- `sync_players()` le fait déjà, mais par fenêtre incrémentale : on force le
-- balayage complet ici, parce qu'une seule ligne manquante ferait échouer la
-- clé étrangère de la phase 2 après vingt minutes de copie.
insert into players (puuid)
select distinct p.puuid
from match_participants p
on conflict (puuid) do nothing;

-- 1.2 — Le pseudo le plus récent de chaque joueur, remonté dans `players`.
--
-- C'est la seule information que `match_participants.riot_id` porte et que
-- `players` pourrait ne pas avoir : `sync_player_counts()` ne rafraîchit que
-- les joueurs vus dans les deux dernières heures. Sans ce filet, un joueur
-- croisé une fois en mai perdrait son pseudo.
--
-- `distinct on` demande un tri de 1,3 M de lignes, et `work_mem` vaut 2 Mo sur
-- une instance Micro — il déborderait sur un disque déjà plein. On le relève
-- pour cette seule transaction.
begin;
set local work_mem = '96MB';
with dernier as (
  select distinct on (p.puuid) p.puuid, p.riot_id
  from match_participants p
  join matches m on m.match_id = p.match_id
  where p.riot_id is not null and p.riot_id <> ''
  order by p.puuid, m.game_creation desc
)
update players pl
set riot_id = dernier.riot_id
from dernier
where pl.puuid = dernier.puuid
  and pl.riot_id is distinct from dernier.riot_id;
commit;

-- 1.3 — Vérification. Doit rendre 0.
--   select count(*) from match_participants p
--   where not exists (select 1 from players pl where pl.puuid = p.puuid);

-- 1.4 — L'index qui manquait à la recherche d'un joueur par pseudo.
--
-- Mesuré le 2026-09-22, clé Riot expirée — donc sur le chemin que tout
-- visiteur empruntait : la page d'un joueur mettait 47 s en cherchant dans
-- `match_participants`, 4,6 s dans `players`. Les deux sont des parcours
-- complets ; celui-ci est une recherche.
create index if not exists players_riot_id_lower_idx
  on players (lower(riot_id));

-- ════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — Construire la table compacte
-- ════════════════════════════════════════════════════════════════════════════
--
-- Une table NEUVE, et non un `alter table` sur place. Ajouter une colonne puis
-- la remplir laisserait une version morte de chaque ligne : la table doublerait
-- avant de rétrécir, et `vacuum full` — qui recopie la table pour la compacter
-- — réclamerait à son tour autant de place libre. Sur un disque tendu c'est la
-- manœuvre qui échoue. Écrire directement la forme finale ne paie ce prix
-- qu'une fois.
--
-- Compter ~15 à 25 min sur une instance Micro. À lancer depuis le SQL Editor du
-- dashboard, pas via PostgREST (statement_timeout à 30 s).

create table if not exists match_participants_v2 (
  match_id   text     not null references matches (match_id) on delete cascade,
  player_id  integer  not null references players (id),
  subteam_id smallint not null,
  placement  smallint not null,
  champion   text     not null,
  kills      smallint not null,
  deaths     smallint not null,
  assists    smallint not null,
  augments   integer[] not null default '{}',
  items      integer[] not null default '{}',
  item_order integer[],
  -- La clé primaire EST l'index de l'upsert (`on conflict (match_id, player_id)`)
  -- et celui de la pagination (`order by match_id, player_id`). L'ancienne table
  -- en portait deux pour ce travail : une PK sur un `id` bigint que rien ne
  -- lisait (42 Mo, 0 lecture) et un unique sur (match_id, puuid) — 208 Mo, le
  -- plus gros objet de la base. Un seul index de ~46 Mo les remplace.
  primary key (match_id, player_id)
);

-- La copie. `on conflict do nothing` la rend reprenable : si elle est coupée,
-- on la relance et elle repart là où elle en était.
insert into match_participants_v2 (
  match_id, player_id, subteam_id, placement, champion,
  kills, deaths, assists, augments, items, item_order
)
select
  p.match_id,
  pl.id::integer,
  p.subteam_id::smallint,
  p.placement::smallint,
  p.champion,
  p.kills::smallint,
  p.deaths::smallint,
  p.assists::smallint,
  p.augments,
  p.items,
  p.item_order
from match_participants p
join players pl on pl.puuid = p.puuid
on conflict (match_id, player_id) do nothing;

-- L'index des pages de joueur : `fetchPlayerRows` lit les parties d'un seul
-- joueur. Remplace `match_participants_puuid_idx` (44 Mo) par ~21 Mo, le puuid
-- de 79 octets devenant un entier de 4.
create index if not exists match_participants_v2_player_idx
  on match_participants_v2 (player_id);

-- L'exclusion des équipes AFK, index partiel — transposition exacte de
-- `match_participants_afk_idx` (voir le raisonnement dans schema.sql : il fait
-- passer l'anti-jointure de 149 073 buffers à 10 285).
create index if not exists match_participants_v2_afk_idx
  on match_participants_v2 (match_id, subteam_id)
  where items && array[220008, 220009, 220010, 220011];

analyze match_participants_v2;

-- 2.1 — Vérification AVANT l'échange. Les deux comptes doivent être égaux.
--   select
--     (select count(*) from match_participants)    as avant,
--     (select count(*) from match_participants_v2) as apres;
--
-- Et la taille, pour constater le gain :
--   select pg_size_pretty(pg_total_relation_size('match_participants'))    as avant,
--          pg_size_pretty(pg_total_relation_size('match_participants_v2')) as apres;

-- ════════════════════════════════════════════════════════════════════════════
-- PHASE 3 — L'échange
-- ════════════════════════════════════════════════════════════════════════════
--
-- MOTEUR DE CRAWL À L'ARRÊT. Tout en une transaction : ou bien la base est dans
-- l'ancien état, ou bien dans le nouveau, jamais entre les deux.
--
-- Les vues et la table matérialisée dépendent de la table par leur nom : il
-- faut les détruire avant de renommer, puis les recréer sur la nouvelle forme.

begin;

drop materialized view if exists participants_published;
drop view if exists rating_input;
drop view if exists participants_clean;

drop table match_participants;
alter table match_participants_v2 rename to match_participants;

alter index match_participants_v2_player_idx rename to match_participants_player_idx;
alter index match_participants_v2_afk_idx    rename to match_participants_afk_idx;

grant select, insert, update, delete on match_participants to service_role;

-- ─── participants_clean ─────────────────────────────────────────────────────
--
-- Reprend la définition RÉELLEMENT en base au 2026-09-22 (schema.sql avait
-- divergé : sa version n'avait ni `patch` ni `skill_bucket`). `puuid` et
-- `riot_id` en sortent, `player_id` les remplace.
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
--
-- Règle inchangée : les deux patchs les plus récents à au moins 5 matchs, la
-- même que `patch_options()`. C'est ce qui fait que la bascule de patch se
-- produit toute seule. `id` disparaît de la vue ; l'unique qui autorise le
-- `refresh concurrently` devient (match_id, player_id).
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
-- L'ordre exact de la pagination du job.
create index participants_published_page_idx
  on participants_published (patch, match_id, player_id);

grant select on participants_published to service_role;

-- ─── rating_input ───────────────────────────────────────────────────────────
--
-- `player_idx` était un `dense_rank() over (order by puuid)` — un numéro
-- fabriqué à chaque lecture pour éviter de transporter 78 octets par ligne.
-- `player_id` est ce numéro, en vrai et stable d'une passe à l'autre.
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
-- PHASE 4 — Les fonctions qui lisaient le puuid des participations
-- ════════════════════════════════════════════════════════════════════════════

-- 4.1 — site_totals : compte les joueurs distincts.
--
-- Le commentaire d'origine disait de `total_players` qu'il était « la dernière
-- raison de faire sortir puuid de Postgres ». Il n'en sort plus, et le distinct
-- porte sur 4 octets au lieu de 78 — le tri tient en mémoire au lieu de
-- déborder.
create or replace function site_totals()
returns table (total_matches bigint, total_champions bigint, total_players bigint)
language sql
stable
as $$
  select count(distinct match_id), count(distinct champion), count(distinct player_id)
  from participants_clean
$$;

grant execute on function site_totals() to service_role;

-- 4.2 — leaderboard_top : passe par `players` pour retrouver les parties.
--
-- `player_ratings` reste clée par puuid ; un saut par `players` suffit à
-- retrouver le `player_id`, soit 1 000 sondes d'index par appel.
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

-- 4.3 — sync_match_rating_rows : la jointure vers `players` disparaît.
--
-- Elle existait pour traduire le puuid en entier (`array_agg(pl.id::integer)`).
-- L'entier est maintenant dans la ligne : une jointure de moins sur chaque
-- match reconstruit.
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

-- 4.4 — sync_player_counts : le rafraîchissement des pseudos disparaît.
--
-- Il lisait `match_participants.riot_id` pour recopier le pseudo le plus récent
-- dans `players`. Le crawler écrit désormais directement dans `players` au
-- moment où il résout le puuid en identifiant — l'information arrive à la
-- source, il n'y a plus rien à rattraper après coup. Mesuré au 2026-09-15, ce
-- bloc coûtait 122 ms et 5 582 buffers par passe ; surtout, c'était la dernière
-- lecture de `riot_id` sur les participations.
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

-- 4.5 — sync_players : devient inutile.
--
-- Le crawler crée la ligne `players` lui-même, puisqu'il lui faut l'identifiant
-- pour écrire la participation. La fonction ne trouverait donc plus jamais rien
-- à insérer. On la garde comme filet — elle coûte une lecture d'index par passe
-- quand il n'y a rien à faire — mais elle n'est plus sur le chemin critique.
--
-- Rien à exécuter ici : c'est une note, pas une modification.

-- ════════════════════════════════════════════════════════════════════════════
-- PHASE 5 — Après la fusion de la branche, et seulement après
-- ════════════════════════════════════════════════════════════════════════════
--
-- Reconstruire la table matérialisée et republier, puis constater :
--
--   select refresh_published_participants();
--   select pg_size_pretty(pg_database_size(current_database()));
--
-- Attendu : de 1 218 Mo à ~800 Mo, et un job horaire qui repasse au vert.
--
-- Puis relancer le moteur :
--   gh workflow run engine.yml -f minutes=330
