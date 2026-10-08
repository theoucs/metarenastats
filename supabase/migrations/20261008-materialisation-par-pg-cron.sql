-- La matérialisation de participants_published passe dans pg_cron. Appliquée le 2026-10-08.
--
-- Le job l'appelait en RPC, donc à travers la passerelle HTTP de Supabase, qui
-- coupe une requête bien avant les 180 s de la fonction. Tant que la vue
-- tenait en moins d'une minute, ça passait. Avec 16.19 (1,19 M de
-- participations), elle a atteint 66 s en moyenne : la passerelle répondait
-- « upstream request timeout », mais côté base le rafraîchissement continuait
-- de tourner, en plein pendant la publication. `site_totals` et
-- `leaderboard_top` montaient alors aux 30 s de service_role et la
-- publication échouait — 20 échecs sur 22 entre le 7 et le 8 octobre, et une
-- vue restée figée sur 16.18 + 16.19 alors que 16.20 était sorti.
--
-- pg_cron tourne dans la base : pas de passerelle, et le délai devient celui
-- de la fonction. :11, soit avant la publication de :17, qui lit la vue
-- fraîche. Le `skill_bucket` figé vient donc du classement de l'heure
-- précédente, ce qui ne change rien à une heure près.

alter function refresh_published_participants() set statement_timeout = '15min';

select cron.schedule(
  'refresh-published-participants',
  '11 * * * *',
  $$select public.refresh_published_participants()$$
);
