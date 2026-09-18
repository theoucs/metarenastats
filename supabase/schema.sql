-- Schéma initial MetaArenaStats
-- À exécuter dans Supabase : Dashboard > SQL Editor > New query > coller > Run

create table if not exists matches (
  match_id text primary key,
  game_creation timestamptz not null,
  queue_id integer not null
);

create table if not exists match_participants (
  id bigint generated always as identity primary key,
  match_id text not null references matches (match_id) on delete cascade,
  puuid text not null,
  riot_id text not null,
  subteam_id integer not null,
  placement integer not null,
  champion text not null,
  kills integer not null,
  deaths integer not null,
  assists integer not null,
  augments integer[] not null default '{}',
  items integer[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (match_id, puuid)
);

-- Migration (si la table existe déjà sans cette colonne) :
-- alter table match_participants add column if not exists items integer[] not null default '{}';

create index if not exists match_participants_puuid_idx on match_participants (puuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Patch de la partie (2026-09-14)
--
-- Riot écrit la version du jeu dans chaque match : `gameVersion` vaut par
-- exemple « 16.18.817.5716 ». C'est la SEULE source fiable pour ranger une
-- partie dans un patch. Surtout pas la date d'ingestion : le crawler découvre
-- en permanence des joueurs dont il récupère tout l'historique, et une partie
-- ingérée aujourd'hui peut dater de mai. Certains joueurs font dix parties par
-- jour, d'autres dix par an.
alter table matches add column if not exists game_version text;

-- Le patch court (« 16.18 »), DÉRIVÉ et non recopié : une colonne générée ne
-- peut pas diverger de la valeur brute, là où un second champ écrit par l'app
-- finirait par se désynchroniser. `nullif` couvre la version vide, qui
-- donnerait le patch « . ».
alter table matches add column if not exists patch text
  generated always as (
    nullif(split_part(game_version, '.', 1) || '.' || split_part(game_version, '.', 2), '.')
  ) stored;

-- Patch DÉDUIT par comparaison de date, pour les matchs antérieurs au
-- 2026-09-14 qui n'ont pas de `game_version`. On ne fabrique jamais une fausse
-- version : l'observé et le déduit restent deux colonnes distinctes.
alter table matches add column if not exists patch_deduced text;

-- `patch` dérive des DEUX sources, l'observé l'emportant sur le déduit. Une
-- colonne générée ne peut pas en référencer une autre, d'où le découpage répété.
alter table matches drop column if exists patch;
alter table matches add column patch text
  generated always as (
    coalesce(
      nullif(split_part(game_version, '.', 1) || '.' || split_part(game_version, '.', 2), '.'),
      patch_deduced
    )
  ) stored;

-- Savoir si un match porte le patch que Riot a écrit ou celui qu'on a déduit :
-- le jour où un chiffre surprend, on peut répondre « c'est une déduction ».
alter table matches add column if not exists patch_exact boolean
  generated always as (game_version is not null) stored;

create index if not exists matches_patch_idx on matches (patch, game_creation desc);
create index if not exists matches_patch_missing_idx
  on matches (game_creation)
  where game_version is null and patch_deduced is null;

-- Frontières de patch, trouvées par dichotomie (scripts/find-patch-boundaries.mjs,
-- `npm run patches`). 22 appels Riot ont suffi à dater les deux bascules, là où
-- redemander la version de chaque match en aurait coûté 2 077.
create table if not exists patch_windows (
  patch text primary key,
  starts_at timestamptz not null,
  -- Écart entre les deux matchs qui encadrent la bascule : au-delà, une partie
  -- jouée dans cette fenêtre pourrait être rangée dans le patch précédent.
  precision_minutes integer,
  found_at timestamptz not null default now()
);

grant select, insert, update, delete on patch_windows to service_role;

create index if not exists match_participants_champion_idx on match_participants (champion);

-- L'exclusion des équipes AFK coûtait 80 % des accès de `participants_clean`.
--
-- Mesuré le 2026-09-15 sur une page de 10 000 lignes du patch 16.17 :
-- 184 720 buffers lus au total, dont 149 073 pour la seule anti-jointure. Pour
-- CHAQUE ligne candidate, Postgres relisait les 18 participants de la partie
-- par `(match_id, puuid)` puis les filtrait sur les objets sentinelles —
-- « Rows Removed by Filter: 18 », donc 18 lignes lues pour en garder zéro.
--
-- L'index partiel ne contient que les lignes réellement AFK, qui sont rares :
-- la sonde devient une recherche directe sur `(match_id, subteam_id)` dans un
-- index minuscule. Après : 45 838 buffers, dont 10 285 pour l'anti-jointure.
create index if not exists match_participants_afk_idx
  on match_participants (match_id, subteam_id)
  where items && array[220008, 220009, 220010, 220011];

-- ─── PAGINER PAR MATCH, ET NON PAR id ──────────────────────────────────────
--
-- La lecture des participants d'un patch avance par curseur. Le curseur était
-- `match_participants.id`, ce qui paraissait naturel — c'est la clé primaire.
-- Mais le patch vit dans `matches` : aucun index ne donne « les lignes de ce
-- patch, dans l'ordre des id ». Postgres lisait donc tout le reste de la table
-- depuis le curseur, jetait les autres patchs, puis TRIAIT le reste pour en
-- prendre 10 000 — le `limit` ne pouvant plus s'arrêter tôt, une page coûtait
-- la taille de la table et la lecture entière devenait quadratique.
--
-- Sans conséquence tant que la base était petite. À 800 000 lignes, une page
-- dépassait le `statement_timeout` et la publication échouait (17/09, 13h35).
--
-- Cet index rend l'autre ordre possible : les matchs du patch arrivent triés
-- par match_id, et chacun tire ses 18 participants par `(match_id, puuid)`.
-- Postgres s'arrête dès qu'il a ses 10 000 lignes. Mesuré à profondeur et
-- cache égaux sur le patch 16.17 :
--
--                    par id          par match_id
--   durée            3 693 ms            85 ms
--   buffers          136 063          31 377
--
-- Et surtout, le coût d'une page ne dépend plus de la taille de la base.
create index if not exists matches_patch_match_id_idx on matches (patch, match_id);

-- Le `skill_bucket` de la vue vient d'une jointure sur `player_ratings`, soit
-- une sonde par ligne lue. `player_ratings_pkey` porte le puuid seul : chaque
-- sonde descendait dans l'index PUIS allait chercher `tier` dans la table.
-- En embarquant `tier`, la sonde ne quitte plus l'index — mesuré sur une page
-- de 10 000 lignes, 27 356 buffers pour cette jointure contre 22 215 après,
-- et le nœud cesse d'être le poste dominant de la requête.
create index if not exists player_ratings_puuid_tier_idx
  on player_ratings (puuid) include (tier);

-- ─── AUTOVACUUM : garder la carte de visibilité chaude ──────────────────────
--
-- Un « index only scan » ne mérite son nom que si la page est marquée
-- entièrement visible. Sinon Postgres va quand même chercher la ligne dans la
-- table, et le parcours d'index redevient un parcours de table.
--
-- `sync_player_counts` met à jour `players.games` par milliers à chaque heure,
-- ce qui salit la carte ; l'autovacuum par défaut (20 % de la table, soit
-- 17 000 lignes ici) ne repassait pas entre deux publications. Mesuré le
-- 2026-09-15 sur l'anti-jointure de `sync_players` :
--
--                        avant       après un VACUUM
--   heap fetches         157 145           0        (players)
--                         72 427       4 207        (match_participants)
--   buffers               99 648       9 474
--   durée                  6,4 s       2,7 s
--
-- Le vacuum tourne en tâche de fond : ce temps ne disparaît pas, il sort du
-- chemin critique du job.
alter table players
  set (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.02);
alter table match_participants
  set (autovacuum_vacuum_insert_scale_factor = 0.02, autovacuum_vacuum_scale_factor = 0.05);
alter table player_ratings
  set (autovacuum_vacuum_scale_factor = 0.05);

-- "Automatically expose new tables" étant désactivé sur le projet (bonne pratique),
-- les tables créées via le SQL Editor ne reçoivent aucun droit par défaut, même pour
-- service_role. On accède exclusivement via cette clé côté serveur, donc on lui donne
-- les droits explicitement (pas de droits pour anon/authenticated : accès non public).
grant usage on schema public to service_role;
grant select, insert, update, delete on matches to service_role;
grant select, insert, update, delete on match_participants to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Snapshots de stats pré-calculées (2026-09-13, plan docs/data-pipeline-plan.md)
--
-- Avant : chaque page chargeait TOUTE la base en mémoire JS pour agréger à la
-- volée (3,7 Mo d'egress Supabase par vue de page à 900 matchs, et une
-- troncature muette au-delà de 30 000 lignes).
-- Après : un job périodique calcule chaque agrégat une fois et le stocke ici ;
-- les pages lisent une seule ligne de quelques Ko.
--
-- `key` identifie l'agrégat ("champions", "items", "champion:ahri", …).
-- `payload` est la sortie exacte de l'agrégateur correspondant, en JSON.
create table if not exists stats_snapshots (
  key text primary key,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  -- Volume de données ayant servi au calcul : permet d'afficher la fraîcheur
  -- et de détecter un snapshot calculé sur une base tronquée.
  source_matches integer not null default 0,
  source_participants integer not null default 0,
  truncated boolean not null default false
);

grant select, insert, update, delete on stats_snapshots to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Crawler (2026-09-13, phase 1 de docs/data-pipeline-plan.md)

-- Marqueur d'ingestion complète.
--
-- `persistMatches` écrit d'abord la ligne `matches`, puis les participants (la
-- clé étrangère impose cet ordre). Si la seconde écriture échoue, le match reste
-- enregistré à vide, et plus rien ne le signale : 161 matchs sur 913 étaient
-- dans cet état au moment d'écrire ceci.
--
-- `ingested_at` n'est posé qu'une fois les 18 participants écrits. Un match à
-- NULL est donc incomplet *par définition*, et le crawler le reprend tout seul
-- au passage suivant. C'est ce qui rend l'ingestion auto-réparante plutôt que
-- silencieusement trouée.
alter table matches add column if not exists ingested_at timestamptz;

-- Les matchs à reprendre. Index partiel : il ne contient que les incomplets,
-- donc il reste minuscule même avec des millions de matchs ingérés.
create index if not exists matches_pending_idx on matches (match_id) where ingested_at is null;

-- File de crawl : les joueurs à explorer.
--
-- Chaque partie récupérée révèle 17 nouveaux joueurs, d'où l'effet boule de
-- neige — on ne manque jamais de graines.
create table if not exists crawl_queue (
  puuid text primary key,
  -- 0 = découverte (couverture large, pour les stats de méta)
  -- 1 = suivi (re-crawl de joueurs actifs, pour la profondeur du classement)
  -- Les deux modes doivent exister dès le schéma : le boule de neige seul donne
  -- des centaines de milliers de joueurs à 2-3 parties chacun, ce qui convient
  -- à la méta mais ne permet aucun classement crédible.
  priority smallint not null default 0,
  last_crawled_at timestamptz,
  discovered_at timestamptz not null default now(),
  matches_found integer not null default 0,
  -- Isole les puuid qui échouent en boucle pour ne pas bloquer la file.
  error_count smallint not null default 0
);

-- Ordre de service : priorité décroissante, puis jamais-crawlé, puis le plus ancien.
create index if not exists crawl_queue_next_idx
  on crawl_queue (priority desc, last_crawled_at asc nulls first)
  where error_count < 5;

grant select, insert, update, delete on crawl_queue to service_role;

-- ── Reprise de l'existant ────────────────────────────────────────────────────
-- Marque comme ingérés les matchs déjà complets ; les autres (161 vides + 1
-- partiel hérité de l'époque où seule l'équipe du joueur était sauvée) restent
-- à NULL et seront réparés par le crawler.
update matches m
set ingested_at = now()
where m.ingested_at is null
  and (select count(*) from match_participants p where p.match_id = m.match_id) = 18;

-- Amorce la file avec tous les joueurs déjà connus.
insert into crawl_queue (puuid)
select distinct puuid from match_participants
on conflict (puuid) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ordre d'achat des items (2026-09-14, phase 2 de docs/data-pipeline-plan.md)
--
-- `items` conserve l'ordre des SLOTS D'INVENTAIRE de Riot (item0..item6), qui
-- n'a rien à voir avec l'ordre d'achat — vérifié sur EUW1_7982040680 où Xayah
-- achète Boots → Collector → Infinity Edge mais où l'inventaire final les range
-- Boots, Reaper's Toll, Collector, IE.
--
-- Le vrai ordre ne vit que dans le Match Timeline, une requête distincte et
-- 10,7× plus lourde (1,48 Mo contre 138 Ko) — d'où une passe séparée plutôt
-- qu'un appel supplémentaire à chaque match ingéré, ce qui diviserait par deux
-- la couverture en matchs.
--
-- Ce que le timeline ne donne PAS : les items prismatiques, jamais achetés en
-- boutique (mesuré : 20 visibles dans le timeline contre 183 réellement
-- possédés). `item_order` liste donc les achats en boutique uniquement — bottes
-- et légendaires — et complète `items`, il ne le remplace pas.
alter table match_participants add column if not exists item_order integer[];

-- Marqueur de récupération du timeline, sur le même principe que `ingested_at` :
-- NULL = à faire. Un match dont le timeline est illisible reste à NULL et sera
-- retenté, ce qui est sans gravité (la passe est bornée et priorise le récent).
alter table matches add column if not exists timeline_fetched_at timestamptz;

-- Index partiel : ne contient que les matchs dont le timeline reste à récupérer,
-- donc minuscule une fois le rattrapage terminé.
create index if not exists matches_timeline_pending_idx
  on matches (game_creation desc)
  where timeline_fetched_at is null and ingested_at is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Agrégation côté base (2026-09-14, phase 3 de docs/data-pipeline-plan.md)
--
-- Participants retenus par les stats : la table brute moins les équipes AFK.
--
-- Un joueur qui finit la partie avec un « Anvil Voucher » en poche
-- (220008-220011) ne l'a jamais consommé : il n'a pas joué. Riot enregistre
-- quand même un placement pour son équipe, mais ce placement reflète un 2v3,
-- pas un résultat. Toute l'équipe sort donc de toutes les stats pour ce match —
-- même règle que dropAfkTeams() côté app, dont c'est la transposition.
create or replace view participants_clean as
select p.*
from match_participants p
where not exists (
  select 1
  from match_participants afk
  where afk.match_id = p.match_id
    and afk.subteam_id = p.subteam_id
    and afk.items && array[220008, 220009, 220010, 220011]
);

grant select on participants_clean to service_role;

-- ─── LA TABLE MATÉRIALISÉE DES PATCHS PUBLIÉS ──────────────────────────────
--
-- `participants_clean` est une vue à trois jointures : le patch vient de
-- `matches`, le `skill_bucket` de `player_ratings`, l'exclusion des équipes AFK
-- est une anti-jointure. Une lecture COMPLÈTE les paie une fois — mesuré à
-- 34 000 buffers pour un patch entier. Mais la lecture du job est paginée, et
-- chacune des 23 pages d'un patch refaisait les trois :
--
--   par page, depuis la vue                31 377 buffers, 3 nœuds de jointure
--   par page, depuis cette table            7 666 buffers, une plage d'index
--   le patch entier en une passe           34 000 buffers
--
-- Soit 720 000 buffers pour lire ce qui en coûte 34 000. Vingt fois le travail,
-- pour la même donnée.
--
-- Ne contenir QUE les deux patchs publiés n'est pas une économie de place, c'est
-- ce qui rend la chose durable : `match_participants` grossit sans fin (27 000
-- matchs le 16/09, 44 000 le 17/09), mais ce qu'on publie restera deux patchs.
-- Les patchs périmés cessent de peser sur la lecture.
--
-- Le `limit 2` reproduit exactement `patch_options` (voir lib/patches.ts) : si
-- les deux divergeaient, le site demanderait un patch que la table n'aurait pas.
-- Le code client sait retomber sur la vue dans ce cas — ce qui arrive une fois
-- par changement de patch, avant le premier rafraîchissement.
create materialized view if not exists participants_published as
select pc.id,
       pc.match_id,
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

-- L'unique est ce qui autorise `refresh ... concurrently`, donc un
-- rafraîchissement sans verrou pour les lecteurs. Mesuré : 19,2 s en simple,
-- 18,6 s en concurrent — le concurrent ne coûte rien de plus ici, la plupart
-- des lignes étant inchangées d'une passe à l'autre.
create unique index if not exists participants_published_id_idx
  on participants_published (id);
-- L'ordre exact de la pagination du job : (patch, match_id, id).
create index if not exists participants_published_page_idx
  on participants_published (patch, match_id, id);

grant select on participants_published to service_role;

-- Le rafraîchissement passe par une fonction pour deux raisons : PostgREST ne
-- sait pas lancer un `refresh`, et le `statement_timeout` de service_role (30 s)
-- est trop court pour une opération qui dure déjà 19 s et grossit avec la base.
-- On le relève ICI seulement — le plafond des requêtes ordinaires doit rester
-- court pour que les lenteurs se voient.
--
-- Appelé par le job APRÈS la passe MMR, qui vient de réécrire `player_ratings` :
-- la table fige le `skill_bucket`, elle doit figer le plus récent.
create or replace function refresh_published_participants()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '180s'
as $$
begin
  refresh materialized view concurrently participants_published;
end;
$$;

grant execute on function refresh_published_participants() to service_role;

-- Les trois compteurs de l'accueil, comptés en base.
--
-- `total_players` était la dernière raison de faire sortir `puuid` de Postgres
-- pour l'agrégation : 78 octets par ligne, sur 27 000 lignes, pour produire un
-- entier.
create or replace function site_totals()
returns table (total_matches bigint, total_champions bigint, total_players bigint)
language sql
stable
as $$
  select count(distinct match_id), count(distinct champion), count(distinct puuid)
  from participants_clean
$$;

grant execute on function site_totals() to service_role;

-- Classement calculé dans Postgres.
--
-- Deux problèmes d'un coup :
--
-- 1. `puuid` + `riot_id` pèsent 67 des 109 octets d'une ligne participant sur
--    le fil — 61 % de l'egress d'un rafraîchissement — et le classement est le
--    SEUL agrégateur qui en a besoin. Le calculer ici les laisse en base.
-- 2. Le snapshot du classement pesait 3,6 Mo, plus qu'une lecture complète de
--    la base, relu à chaque régénération de la page. Mesuré : 14 131 des 17 588
--    joueurs n'avaient qu'UNE partie. À une partie on fait 0 % ou 100 % de
--    top 3 : ces lignes ne classent personne, elles pèsent.
--
-- Renvoie les compteurs bruts, pas des pourcentages : la mise en forme (toStat)
-- reste côté app, au même endroit que pour tous les autres tableaux.
-- Le haut du classement, trié et borné EN SQL.
--
-- La version précédente rendait les compteurs bruts sans ordre ni limite, et
-- l'application recollait ensuite les rangs lus séparément. Les deux lectures
-- étaient plafonnées en silence à 1 000 lignes par PostgREST : sur 8 467
-- joueurs classés, la page affichait 1 000 joueurs arbitraires dont 775 sans
-- aucun rang, et 112 seulement du vrai top 1 000. Un tri en mémoire ne rattrape
-- jamais ce qu'une lecture tronquée n'a pas rapporté — d'où le tri ET la coupe
-- ramenés là où sont les données.
--
-- Le seuil de parties n'est plus un paramètre : player_ratings ne contient que
-- des joueurs déjà au-dessus (voir lib/rating.ts).
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
    select r.puuid, r.riot_id, r.rank_position, r.tier
    from player_ratings r
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
  join participants_clean p on p.puuid = top.puuid
  group by top.puuid, top.riot_id, top.rank_position, top.tier
  order by top.rank_position
$$;

grant execute on function leaderboard_top(integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Classement des joueurs par MMR (2026-09-14)
--
-- Le calcul lui-même est en TypeScript (lib/rating.ts) : le MMR se construit
-- partie après partie, dans l'ordre chronologique, ce qu'une requête
-- d'agrégation ne sait pas faire. Le SQL ne fait donc que préparer l'entrée et
-- ranger la sortie.

-- Chaque participation, avec un index entier par joueur.
--
-- L'index existe pour l'egress. Rejouer toute l'histoire, c'est relire 37 000
-- participations à chaque passe. Les sortir avec leur puuid (78 caractères,
-- incompressibles) coûterait ~2 Mo par passe, soit ~1,4 Go par mois pour un job
-- horaire. Un entier par joueur ramène la même information à ~100 Ko.
create or replace view rating_input as
select
  p.match_id,
  p.puuid,
  p.riot_id,
  p.subteam_id,
  p.placement,
  m.game_creation,
  dense_rank() over (order by p.puuid) as player_idx
from participants_clean p
join matches m on m.match_id = p.match_id;

grant select on rating_input to service_role;

-- Une ligne par match, dans l'ordre chronologique strict.
--
-- `ord` rend cet ordre explicite dans la réponse. PostgREST pagine par en-tête
-- Range, et rien ne garantit qu'il conserve le tri interne d'une fonction d'une
-- page à l'autre. Or ici l'ordre N'EST PAS un confort d'affichage : deux pages
-- mal recollées donnent un classement faux, sans rien signaler.
-- Révisée le 2026-09-15 : pagination PAR CURSEUR, et lecture d'un cache.
--
-- `ord` a disparu avec la pagination par en-tête Range. PostgREST applique
-- Range APRÈS la requête : chaque page réagrégeait donc les 12 000 matchs pour
-- n'en garder que mille, treize fois de suite. Le couple
-- (game_creation, match_id) sert désormais de curseur — il est unique, il est
-- l'ordre du calcul, et il ne peut pas rendre deux fois la même ligne pendant
-- que le crawler écrit.
--
-- La source n'est plus `rating_input` mais `match_rating_rows`, pré-agrégé par
-- sync_match_rating_rows() : la composition d'un match ne change plus une fois
-- ingéré, il n'y a aucune raison de la recalculer toutes les heures.
create or replace function rating_matches(
  after_created timestamptz default '-infinity',
  after_match text default '',
  page_size integer default 1000
)
returns table (
  game_creation timestamptz,
  match_id text,
  players integer[],
  subteams smallint[],
  placements smallint[]
)
language sql
stable
as $$
  select r.game_creation, r.match_id, r.players, r.subteams, r.placements
  from match_rating_rows r
  where (r.game_creation, r.match_id) > (after_created, after_match)
  order by r.game_creation, r.match_id
  limit page_size
$$;

grant execute on function rating_matches(timestamptz, text, integer) to service_role;

-- L'identité des seuls joueurs qu'on classera : inutile de rapatrier 22 000
-- puuid pour en afficher un millier.
-- Révisée le 2026-09-15 : lit `players`, où le compte et le pseudo sont
-- désormais entretenus par sync_player_counts(), au lieu de les réagréger
-- depuis les participations à chaque page. Paginée par curseur sur `id` pour
-- la même raison que rating_matches.
create or replace function rating_players(
  min_games integer,
  after_idx integer default 0,
  page_size integer default 1000
)
returns table (player_idx integer, puuid text, riot_id text, games bigint)
language sql
stable
as $$
  select pl.id::integer, pl.puuid, coalesce(pl.riot_id, pl.puuid), pl.games::bigint
  from players pl
  where pl.games >= min_games and pl.id > after_idx
  order by pl.id
  limit page_size
$$;

grant execute on function rating_players(integer, integer, integer) to service_role;

-- Le classement publié. Réécrit en entier à chaque passe : le crawler découvre
-- en permanence de vieilles parties, qui s'insèrent AVANT des parties déjà
-- notées. Un calcul incrémental donnerait un classement qui dépend de l'ordre
-- de découverte au lieu de l'ordre de jeu.
create table if not exists player_ratings (
  puuid text primary key,
  riot_id text not null,
  games integer not null,
  -- Compteurs du classement, accumulés par la passe de MMR qui parcourt déjà
  -- toutes les participations. Les recalculer à la lecture coûtait 1,1 s pour
  -- 50 joueurs (jointure + réévaluation de l'exclusion AFK ligne à ligne).
  top3_wins integer not null default 0,
  top1_wins integer not null default 0,
  placement_sum integer not null default 0,
  mu double precision not null,
  sigma double precision not null,
  rank_position integer not null,
  tier text not null,
  updated_at timestamptz not null default now()
);

create index if not exists player_ratings_position_idx on player_ratings (rank_position);

alter table player_ratings enable row level security;
grant select, insert, update, delete on table player_ratings to service_role;

-- Fait passer en « suivi » (priority 1) les joueurs dont on connaît déjà
-- plusieurs parties.
--
-- Le crawler découvrait jusqu'ici en largeur uniquement, et c'est ce qu'il
-- fallait pour les tier lists : elles comptent des participations, peu importe
-- de qui. Le classement, lui, a besoin de PROFONDEUR — un MMR se construit sur
-- les parties d'un même joueur. À 1,6 partie par joueur en moyenne, élargir
-- encore n'améliore plus le classement d'un pouce.
--
-- La file sert donc les deux à parts égales (voir pickPlayers dans
-- lib/crawler.ts). Re-crawler un joueur connu est bon marché : un appel pour
-- lister ses matchs, et `keepNewMatchIds` élimine tout ce qu'on a déjà.
create or replace function promote_tracked_players(min_games integer)
returns integer
language plpgsql
as $$
declare
  promoted integer;
begin
  -- Depuis le 2026-09-15 : `players.games`, entretenu par
  -- sync_player_counts(), plutôt qu'un group by sur les participations —
  -- même réponse, sans réagréger 290 000 lignes à chaque heure.
  update crawl_queue q
  set priority = 1
  from players pl
  where q.puuid = pl.puuid
    and pl.games >= min_games
    and q.priority = 0;
  get diagnostics promoted = row_count;
  return promoted;
end;
$$;

grant execute on function promote_tracked_players(integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Liste des patchs publiables (2026-09-14, révisée le 2026-09-15)
--
-- Lue là où elle est bon marché. La première version parcourait les 240 000
-- participations — anti-jointure AFK et count(distinct match_id) par patch —
-- alors que le patch est une colonne de `matches`, indexée. Elle est appelée à
-- CHAQUE régénération de chacune des six tier lists : 1,48 s contre 0,12 s.
--
-- Ce n'était pas qu'une question de vitesse. Sous la charge du recalcul horaire
-- elle dépassait le délai, et sans liste de patchs une page ne construit AUCUNE
-- vue : il ne restait que le titre, et Next.js gardait cette page vide en cache
-- une demi-heure. Voir getPatchContext, qui lève désormais plutôt que de rendre
-- un contexte vide.
create or replace function patch_options(min_matches integer default 5)
returns table (patch text, matches bigint, newest timestamptz)
language sql
stable
as $$
  select m.patch,
         count(*) as matches,
         max(m.game_creation) as newest
  from matches m
  where m.patch is not null and m.ingested_at is not null
  group by m.patch
  having count(*) >= min_matches
  order by string_to_array(m.patch, '.')::int[] desc
$$;

grant execute on function patch_options(integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cache de calcul du MMR (2026-09-15)
--
-- CONTRAINTE STRUCTURANTE : toute requête passant par l'API PostgREST est
-- coupée à 8 secondes (`authenticator` porte statement_timeout=8s). Ce n'est
-- pas la limite de 300 s de la fonction serverless qui borne le job de
-- publication, c'est celle-ci, requête par requête. Le rôle applicatif a été
-- relevé à 30 s — au-delà, une requête trop longue est un défaut de conception
-- et doit casser bruyamment :
--
--   alter role service_role set statement_timeout = '30s';

-- `players` porte l'identité et le volume de parties, rafraîchis une fois par
-- passe. Avant, `rating_players` réagrégeait les 240 000 participations à
-- chaque page : 2 s l'une, une douzaine de pages.
alter table players add column if not exists riot_id text;
alter table players add column if not exists games integer not null default 0;
create index if not exists players_games_idx on players (games desc, id);

-- Les parties, pré-agrégées sous la forme exacte que le calcul consomme.
--
-- Le MMR doit rejouer TOUTE l'histoire à chaque passe — seule façon d'obtenir
-- un classement reproductible quand le crawler découvre en permanence de
-- vieilles parties qui s'insèrent avant des parties déjà notées. Mais rien
-- n'oblige à RECALCULER cette forme : la composition d'un match ne change plus
-- une fois qu'il est ingéré.
--
-- `built_at` comparé à `matches.ingested_at` : un match réingéré (le crawler
-- répare les matchs incomplets) voit sa ligne reconstruite.
create table if not exists match_rating_rows (
  match_id text primary key references matches (match_id) on delete cascade,
  game_creation timestamptz not null,
  players integer[] not null,
  subteams smallint[] not null,
  placements smallint[] not null,
  built_at timestamptz not null default now()
);

create index if not exists match_rating_rows_chrono_idx
  on match_rating_rows (game_creation, match_id);

-- La fenêtre de la reprise incrémentale de sync_player_counts() : « quels
-- joueurs ont vu une de leurs parties (re)bâtie depuis la dernière passe ».
-- Cet index existait en base sans figurer ici — la reprise en dépend désormais,
-- donc il est déclaré.
create index if not exists match_rating_rows_built_idx
  on match_rating_rows (built_at);

grant select, insert, update, delete on match_rating_rows to service_role;

grant select, insert, update on players to service_role;

-- Plafond de lignes par réponse de l'API, relevé de 1 000 à 20 000.
--
-- Le coût d'une page est presque entièrement dans la MISE EN PLACE de la
-- requête, pas dans le transfert : mesuré le 2026-09-15 sur la vue des
-- participants, 1 000 lignes coûtent 1,54 s et 10 000 lignes 1,28 s. Lire les
-- 116 000 participations d'une passe faisait donc 116 requêtes séquentielles,
-- soit 65 s — un tiers du job de publication.
--
--   alter role authenticator set pgrst.db_max_rows = '20000';
--   notify pgrst, 'reload config';

-- Découpage de la synchronisation des joueurs (2026-09-15).
--
--   sync_players()        identifiants des nouveaux joueurs — AVANT le cache,
--                         qui en a besoin.
--   sync_match_rating_rows()  le cache lui-même, incrémental.
--   sync_player_counts()  volume de parties et pseudo — APRÈS le cache, dont
--                         ils se déduisent.
--
-- Deux mesures ont guidé ce découpage :
--
--   compter les parties par les participations  4,0 s  (jointure + anti-jointure
--                                                       AFK + débordement disque)
--   le même compte sur le cache                 0,5 s
--
--   relire le pseudo sur 3 h de matchs ingérés  13,0 s
--   sur 1 h                                      0,6 s
--
-- La fenêtre du pseudo est volontairement courte : qui n'a pas joué n'a pas pu
-- changer de nom dans nos données, et le coût est presque entièrement
-- proportionnel au nombre de participations à trier.

-- ─── REPRISE INCRÉMENTALE (2026-09-18) ──────────────────────────────────────
--
-- Ces trois fonctions reparcouraient TOUTE la base à chaque heure pour trouver
-- quelques centaines de nouveautés. Sans conséquence à 240 000 participations ;
-- à 1 074 690, la phase MMR pesait 85 s et la publication a fini par dépasser
-- les 300 s de Vercel (échecs des 18/09 00h26 et 11h22).
--
-- Mesuré à cette taille, avant / après :
--
--                            buffers              durée
--   sync_players           276 143 → 35 104    12,9 s → 1,7 s   (10 nouveaux)
--   sync_match_rating_rows  57 722 → 15 772     4,6 s → 0,2 s   (120 matchs)
--   sync_player_counts     867 680 → 115 756    6,4 s → 3,7 s   (0 modifié)
--
-- Chacune garde une passe COMPLÈTE toutes les six heures. C'est ce qui rend la
-- reprise acceptable : le mode de panne redouté — un joueur absent de
-- `players`, dont les parties disparaissent en silence de la jointure interne
-- de `rating_input` — ne survit alors pas à la demi-journée.
--
-- La marge de deux heures sur la fenêtre existe parce qu'`ingested_at` est posé
-- à l'écriture mais devient visible à la validation : une ligne datée T peut
-- apparaître après qu'on a lu max(ingested_at) > T. Deux heures pour un job
-- horaire ne se franchissent qu'avec une transaction bloquée aussi longtemps,
-- et la passe complète rattraperait même ce cas.
create table if not exists rating_sync_state (
  what text primary key,
  watermark timestamptz not null default '-infinity',
  full_swept_at timestamptz not null default '-infinity'
);

grant select, insert, update on rating_sync_state to service_role;

create or replace function sync_players()
returns integer
language plpgsql
as $$
declare
  added integer;
  wm timestamptz;
  swept timestamptz;
  full_sweep boolean;
  started timestamptz := clock_timestamp();
begin
  insert into rating_sync_state (what) values ('players') on conflict (what) do nothing;
  -- `for update` sérialise deux passes qui se chevaucheraient : sans lui, les
  -- deux se croiraient chargées de la passe complète.
  select watermark, full_swept_at into wm, swept
  from rating_sync_state where what = 'players' for update;
  full_sweep := started - swept > interval '6 hours';

  -- Deux requêtes et non une avec un `or` : un booléen de plpgsql dans le WHERE
  -- est un paramètre pour le planificateur, qui renonce alors à l'index sur
  -- `ingested_at` et reparcourt tout — ce qu'on essaie précisément d'éviter.
  if full_sweep then
    insert into players (puuid)
    select distinct p.puuid
    from match_participants p
    where not exists (select 1 from players pl where pl.puuid = p.puuid)
    on conflict (puuid) do nothing;
  else
    insert into players (puuid)
    select distinct p.puuid
    from matches m
    join match_participants p on p.match_id = m.match_id
    where m.ingested_at > wm
      and not exists (select 1 from players pl where pl.puuid = p.puuid)
    on conflict (puuid) do nothing;
  end if;
  get diagnostics added = row_count;

  update rating_sync_state
  set watermark = started - interval '2 hours',
      full_swept_at = case when full_sweep then started else full_swept_at end
  where what = 'players';

  return added;
end;
$$;

grant execute on function sync_players() to service_role;

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

  -- La liste des matchs à bâtir passe par une table temporaire ANALYSÉE.
  --
  -- En sous-requête, le planificateur l'estimait à 20 065 lignes pour 120
  -- réelles, et choisissait donc de hacher les 1 074 690 participations et les
  -- 216 910 joueurs au lieu de sonder par match_id. Avec la vraie taille, il
  -- déroule des boucles imbriquées : 15 772 buffers au lieu de 57 722.
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
    array_agg(pl.id::integer order by pl.id),
    array_agg(p.subteam_id::smallint order by pl.id),
    array_agg(p.placement::smallint order by pl.id),
    now()
  from todo_matches t
  join participants_clean p on p.match_id = t.match_id
  join players pl on pl.puuid = p.puuid
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

  -- Ce n'est PAS l'agrégation qui coûtait, c'est la sonde.
  --
  -- Compter les parties de tout le monde ne lit que `match_rating_rows`, soit
  -- 1 991 buffers — négligeable. Mais comparer le résultat à `players` sondait
  -- l'index primaire 216 421 fois, une par joueur existant : 860 183 buffers
  -- pour, la plupart du temps, ne rien modifier.
  --
  -- On ne compte donc, et on ne sonde, que les joueurs dont une partie vient
  -- d'être (re)bâtie. Le compte d'un joueur ne peut pas changer autrement : il
  -- est le nombre de lignes de `match_rating_rows` qui le citent, et toute
  -- écriture y pose `built_at`.
  --
  -- Le filtre sert deux fois. Il évite les sondes inutiles, et il ramène
  -- l'agrégation de 216 421 groupes à 28 421 : sous ce seuil elle tient en
  -- mémoire, alors qu'elle débordait sur disque (5 lots, 7,5 Mo) — ce
  -- débordement était l'essentiel des secondes, pas les buffers.
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

  -- Deux heures et non trois : le job tourne toutes les heures, donc deux
  -- couvrent la marge. Mesuré, le coût est très sensible à cette fenêtre —
  -- 0,63 s sur une heure, 13 s sur trois — parce qu'elle décide du nombre de
  -- participations à trier.
  --
  -- Et `match_participants` plutôt que `participants_clean` : un pseudo est un
  -- nom d'affichage, il n'a aucune raison de passer par l'exclusion des
  -- équipes AFK. La vue coûtait ici l'anti-jointure ET un second parcours de
  -- `matches`, puisque la requête joignait déjà cette table pour `ingested_at`
  -- et `game_creation`. Mesuré le 2026-09-15 à instrumentation égale
  -- (`explain (analyze, timing off)`) : 796 ms et 20 084 buffers par la vue,
  -- 122 ms et 5 582 buffers sans elle.
  with dernier as (
    select distinct on (p.puuid) p.puuid, p.riot_id
    from matches m
    join match_participants p on p.match_id = m.match_id
    where m.ingested_at > now() - make_interval(hours => recent_hours)
    order by p.puuid, m.game_creation desc
  )
  update players pl
  set riot_id = dernier.riot_id
  from dernier
  where pl.puuid = dernier.puuid and pl.riot_id is distinct from dernier.riot_id;

  update rating_sync_state
  set watermark = started - interval '2 hours',
      full_swept_at = case when full_sweep then started else full_swept_at end
  where what = 'player_counts';

  return touched;
end;
$$;

grant execute on function sync_player_counts(integer) to service_role;

