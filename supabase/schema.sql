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
create or replace function leaderboard_stats(min_games integer)
returns table (
  puuid text,
  riot_id text,
  games bigint,
  top3_wins bigint,
  top1_wins bigint,
  placement_sum bigint
)
language sql
stable
as $$
  select
    p.puuid,
    -- Le pseudo le plus récent : un joueur qui se renomme doit apparaître sous
    -- son nom actuel. (Le calcul JS retenait la dernière ligne lue, donc un
    -- ordre arbitraire.)
    (array_agg(p.riot_id order by m.game_creation desc))[1] as riot_id,
    count(*) as games,
    count(*) filter (where p.placement <= 3) as top3_wins,
    count(*) filter (where p.placement = 1) as top1_wins,
    sum(p.placement) as placement_sum
  from participants_clean p
  join matches m on m.match_id = p.match_id
  group by p.puuid
  having count(*) >= min_games
$$;

grant execute on function leaderboard_stats(integer) to service_role;
