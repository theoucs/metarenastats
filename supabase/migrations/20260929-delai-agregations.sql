-- Délai propre aux agrégations de la publication. Appliquée le 2026-09-29.
--
-- La phase `snapshots` échouait environ une heure sur six (29/09 : 09:17 et
-- 13:17 UTC) sur « canceling statement due to statement timeout ». Coupables,
-- les deux fois : `item_acquisitions` et `landmark_baselines` sur 16.18, coupées
-- aux 30 s de service_role. Sur ce patch (572 000 participations) elles tournent
-- à 25-30 s, en parallèle avec les six autres agrégations : le plafond était
-- atteint à la moindre contention. `augment_timing` passait à 28,9 s.
--
-- Ce n'est pas un défaut de requête : chacune lit un patch entier, sa durée suit
-- la taille du patch, et 16.19 grossira jusque-là. Le budget réel est celui de
-- la route (300 s), dont l'agrégation prend ~72 s. On relève donc le plafond
-- de ces fonctions seulement, comme pour `refresh_published_participants` — les
-- requêtes ordinaires gardent les 30 s qui rendent les lenteurs visibles.
--
-- Sans risque côté visiteurs : anon et authenticated ne lisent pas
-- `participants_published`, un appel de leur part échoue avant de coûter.
alter function anvil_champions(text) set statement_timeout = '120s';
alter function anvil_opener_champions(text, integer[], integer) set statement_timeout = '120s';
alter function anvil_openers(text, integer[]) set statement_timeout = '120s';
alter function anvil_overall(text) set statement_timeout = '120s';
alter function augment_stats(text) set statement_timeout = '120s';
alter function augment_timing(text, integer) set statement_timeout = '120s';
alter function champion_augment_stats(text, integer) set statement_timeout = '120s';
alter function champion_stats(text) set statement_timeout = '120s';
alter function combo_stats(text, integer) set statement_timeout = '120s';
alter function comp_archetypes(text, integer) set statement_timeout = '120s';
alter function comp_coverage(text, integer) set statement_timeout = '120s';
alter function item_acquisitions(text) set statement_timeout = '120s';
alter function landmark_baselines(text) set statement_timeout = '120s';
alter function previous_patch_champion_totals(text) set statement_timeout = '120s';
