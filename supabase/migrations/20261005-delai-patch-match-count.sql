-- `patch_match_count` oublié dans 20260929-delai-agregations.sql. Appliquée le 2026-10-05.
--
-- Même lecture d'un patch entier que les agrégations (count distinct sur
-- participants_published), appelée en parallèle avec elles : coupée aux 30 s de
-- service_role, elle faisait échouer la publication (2 et 5 octobre).
alter function patch_match_count(text) set statement_timeout = '120s';
