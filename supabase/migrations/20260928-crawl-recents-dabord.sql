-- Le crawler visite d'abord les joueurs découverts récemment (voir schema.sql,
-- « La file sert les joueurs récents d'abord »). Appliquée le 2026-09-28.
create index if not exists crawl_queue_next_recent_idx on public.crawl_queue
  using btree (priority, last_crawled_at nulls first, discovered_at desc) where (error_count < 5);
drop index if exists public.crawl_queue_next_idx;
