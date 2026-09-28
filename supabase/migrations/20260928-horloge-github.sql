-- L'horloge des jobs quitte GitHub pour la base.
--
-- Le planificateur de GitHub Actions est « best-effort » : mesuré le 14/09, 25 %
-- des créneaux servis, un trou de près de 8 h ; le 28/09, aucun créneau servi
-- entre 9 h 35 et 17 h, donc plus de crawl dès que le moteur lancé le matin
-- s'est arrêté (16 h 02). Un déclenchement manuel (workflow_dispatch), lui,
-- démarre tout de suite. pg_cron tient l'heure et envoie ce déclenchement.
--
-- Le jeton est un « fine-grained token » GitHub limité au dépôt
-- theoucs/metarenastats et au seul droit Actions (lecture/écriture), rangé dans
-- le Vault sous `github_dispatch_token` par Théo (jamais dans le dépôt), sans
-- date d'expiration. Si les déclenchements répondent un jour 401, c'est qu'il a
-- été révoqué ou supprimé.
--
-- Les crons GitHub des workflows restent en place comme filet. Deux
-- déclenchements rapprochés ne font pas deux moteurs : le groupe de concurrence
-- `riot-api` met le second en attente, et il démarre quand le premier finit, ce
-- qui donne justement une couverture continue.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Schéma privé : PostgREST n'expose que `public`, personne ne peut appeler
-- cette fonction depuis le site.
create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create or replace function ops.dispatch_workflow(workflow text, inputs jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  token text;
begin
  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'github_dispatch_token';
  if token is null then
    raise exception 'secret github_dispatch_token absent du Vault';
  end if;

  return net.http_post(
    url := 'https://api.github.com/repos/theoucs/metarenastats/actions/workflows/' || workflow || '/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'metarenastats-pg-cron',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'main', 'inputs', inputs),
    timeout_milliseconds := 10000
  );
end;
$function$;

revoke all on function ops.dispatch_workflow(text, jsonb) from public, anon, authenticated;

-- Mêmes minutes que les crons GitHub (:09 moteur, :17 publication) : ceux-là
-- restent le filet, et ces horaires-ci ont été choisis loin de l'heure pile,
-- le moment le plus chargé chez GitHub.
select cron.schedule('dispatch-engine', '9 * * * *', $$select ops.dispatch_workflow('engine.yml')$$);
select cron.schedule('dispatch-refresh-stats', '17 * * * *', $$select ops.dispatch_workflow('refresh-stats.yml')$$);
