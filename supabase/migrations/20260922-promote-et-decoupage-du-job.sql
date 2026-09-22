-- ════════════════════════════════════════════════════════════════════════════
-- LE JOB HORAIRE NE TIENT PLUS DANS 300 s — 2026-09-22
-- ════════════════════════════════════════════════════════════════════════════
--
-- Indépendant de la compression des participations, et plus urgent : le patch
-- 16.19 est attendu vers le 24/09, et c'est ce job qui fait basculer le site
-- d'un patch à l'autre. S'il ne passe pas, la bascule ne se fait pas.
--
-- Une fois le disque desserré (passage en Pro ce matin), le job a cessé
-- d'échouer sur « No space left on device » pour échouer sur le délai. Relevé
-- de la tentative de 08:41, en millisecondes :
--
--   patchContext        1 294
--   mmr                96 139     dont syncPlayers 14 532, syncCounts 14 104,
--                                 lectureMatchs 18 113, lectureJoueurs 16 533,
--                                 ecritureClassement 19 665
--   promote           166 703     ← puis « canceling statement due to
--                                    statement timeout »
--
-- 264 secondes consommées avant même d'avoir touché à la matérialisation
-- (~92 s la fois d'avant) et aux agrégations (~150 s). Le budget est de 300.
--
-- Deux problèmes distincts, deux correctifs.

-- ════════════════════════════════════════════════════════════════════════════
-- 1 — promote_tracked_players : 166 s pour promouvoir une poignée de joueurs
-- ════════════════════════════════════════════════════════════════════════════
--
-- La fonction joint `crawl_queue` (230 000 lignes, clée sur un puuid texte) à
-- `players` (245 000) sur ce puuid, pour passer en priorité 1 les joueurs ayant
-- atteint trois parties.
--
-- Le RÉSULTAT est minuscule — seuls les joueurs qui viennent de franchir le
-- seuil changent d'état, quelques dizaines par heure — mais le CHEMIN pour y
-- arriver est une jointure complète entre deux tables de 230 000 lignes, sur
-- une colonne de 79 octets. Avec `work_mem` à 2,1 Mo sur une instance Micro,
-- la table de hachage ne tient pas : Postgres la découpe en lots et les écrit
-- sur disque. C'est ce débordement qui coûte les 166 secondes, pas le calcul.
--
-- Deux changements, tous deux sur le CHEMIN, aucun sur le résultat :
--
--   1. Le CTE `materialized` force l'ordre. Les joueurs à trois parties et plus
--      sont ~67 000, lisibles par `players_games_idx` ; une fois ce lot connu
--      et compté, le planificateur sait qu'il a intérêt à sonder la clé
--      primaire de `crawl_queue` plutôt qu'à tout hacher. Sans `materialized`
--      il aplatit le CTE dans la requête et retombe sur la jointure complète.
--
--   2. `set work_mem` donne de la place au cas où il choisirait quand même de
--      hacher. 64 Mo sur une instance de 1 Go de RAM : la fonction est appelée
--      une fois par heure, jamais en parallèle d'elle-même.
--
-- `security definer` est nécessaire pour que le `set` s'applique : sans lui le
-- réglage du rôle appelant l'emporterait.
create or replace function promote_tracked_players(min_games integer)
returns integer
language plpgsql
security definer
set search_path = public
set work_mem = '64MB'
as $$
declare
  promoted integer;
begin
  -- `players.games`, entretenu par sync_player_counts(), plutôt qu'un group by
  -- sur les participations — même réponse, sans réagréger 290 000 lignes.
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
$$;

grant execute on function promote_tracked_players(integer) to service_role;

-- Vérification, une fois la base au repos. Attendu : quelques secondes, et un
-- nombre de lignes promues qui se compte en dizaines.
--
--   explain (analyze, buffers, timing off)
--   with candidats as materialized (select puuid from players where games >= 3)
--   update crawl_queue q set priority = 1 from candidats c
--   where q.puuid = c.puuid and q.priority = 0;
--
-- Si le débordement persiste, le correctif suivant est un index partiel
-- `crawl_queue (puuid) where priority = 0` — ~18 Mo, à ne prendre que si la
-- mesure le réclame.

-- ════════════════════════════════════════════════════════════════════════════
-- 2 — Le découpage du job : rien à exécuter ici
-- ════════════════════════════════════════════════════════════════════════════
--
-- Le second problème n'est pas une requête lente, c'est un job qui fait deux
-- métiers dans une seule invocation de 300 secondes :
--
--   A. le classement — MMR rejoué sur toute l'histoire, promotions, compteurs
--   B. la publication — matérialisation, agrégations, écriture des snapshots
--
-- Les deux ne se parlent qu'en un point : A réécrit `player_ratings`, et la
-- table matérialisée de B fige le `skill_bucket` qui en dérive. B doit donc
-- passer APRÈS A, mais rien n'exige que ce soit dans la même invocation —
-- l'état vit en base entre les deux.
--
-- Les séparer double le budget sans rien changer au calcul : ~100 s pour A,
-- ~250 s pour B, chacun dans ses propres 300 s au lieu de 350 dans 300.
--
-- Fait côté application : `?only=ratings` et `?only=snapshots` sur
-- /api/cron/refresh-stats (voir lib/statsSnapshot.ts), appelés l'un après
-- l'autre par les workflows. Sans paramètre, la route fait toujours les deux —
-- c'est ce qui permet de lancer un recalcul complet à la main.
--
-- Ce n'est PAS la solution de fond. L'agrégation en JS lit 600 000 lignes par
-- patch à travers PostgREST, et ce plafond (MAX_PAGES × PAGE_SIZE) est à
-- 380 000 pour le patch 16.17. Le découpage achète des mois, pas des années :
-- la réponse durable reste l'agrégation en SQL.
