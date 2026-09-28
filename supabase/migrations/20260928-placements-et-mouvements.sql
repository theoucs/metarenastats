-- Distribution des placements, et totaux du patch précédent (phase 5 du plan
-- design, docs/design-plan-2026-09-28.md).
--
-- 1. `champion_stats` rend en plus `placement_counts`, le nombre de parties
--    finies à chaque place de 1 à 6. Même balayage que les compteurs qu'elle
--    rendait déjà : mesuré à part, la distribution coûtait 386 ms par patch ;
--    ajoutée ici, elle ne coûte presque rien. Le type de retour change, d'où le
--    DROP (un CREATE OR REPLACE ne peut pas changer les colonnes rendues).
--    Les anciennes colonnes gardent leur nom : le code déployé avant cette
--    migration continue de fonctionner, il ignore simplement la nouvelle.
--
-- 2. `previous_patch_champion_totals` rend, pour le patch qui précède
--    `target_patch`, les parties et la somme des placements de chaque champion.
--    Sert à repérer les champions qui ont vraiment bougé d'un patch à l'autre.
--    Le patch précédent est lu là où il se trouve : dans les participations
--    publiées s'il y est encore, sinon dans le cumul archivé
--    (`player_champion_totals`). Jamais les deux : pendant l'archivage d'un
--    patch, ses matchs passent progressivement de l'un à l'autre, et additionner
--    les deux compterait deux fois ceux déjà archivés mais pas encore sortis de
--    la table publiée.
--    Les patchs sont comparés numériquement (16.9 < 16.10), pas comme du texte.

drop function if exists public.champion_stats(text);

create function public.champion_stats(target_patch text)
returns table(champion text, games bigint, top1_wins bigint, top3_wins bigint,
              placement_sum bigint, placement_counts bigint[])
language sql
stable
as $function$
  select
    p.champion,
    count(*),
    count(*) filter (where p.placement = 1),
    count(*) filter (where p.placement <= 3),
    sum(p.placement)::bigint,
    array[
      count(*) filter (where p.placement = 1),
      count(*) filter (where p.placement = 2),
      count(*) filter (where p.placement = 3),
      count(*) filter (where p.placement = 4),
      count(*) filter (where p.placement = 5),
      count(*) filter (where p.placement = 6)
    ]
  from participants_published p
  where p.patch = target_patch
  group by p.champion
$function$;

grant execute on function public.champion_stats(text) to public, service_role;

create or replace function public.previous_patch_champion_totals(target_patch text)
returns table(patch text, champion text, games bigint, placement_sum bigint)
language sql
stable
as $function$
  with known as (
    select r.patch from rolled_patches r
    union
    select distinct p.patch from participants_published p
  ),
  prev as (
    select k.patch
    from known k
    where string_to_array(k.patch, '.')::int[] < string_to_array(target_patch, '.')::int[]
    order by string_to_array(k.patch, '.')::int[] desc
    limit 1
  ),
  published as (
    select p.champion, count(*)::bigint as games, sum(p.placement)::bigint as placement_sum
    from participants_published p
    where p.patch = (select patch from prev)
    group by p.champion
  ),
  archived as (
    select t.champion, sum(t.games)::bigint as games, sum(t.placement_sum)::bigint as placement_sum
    from player_champion_totals t
    where t.patch = (select patch from prev)
      and not exists (select 1 from published)
    group by t.champion
  )
  select (select patch from prev), x.champion, x.games, x.placement_sum
  from (select * from published union all select * from archived) x
$function$;

grant execute on function public.previous_patch_champion_totals(text) to public, service_role;
