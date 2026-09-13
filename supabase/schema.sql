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
