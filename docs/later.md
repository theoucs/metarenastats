# Later

Things noticed during the 2026-09-28 audit that don't need doing now, mostly because the
dev key and today's volume keep them harmless. Notes, not a plan: each one gets rethought
when it becomes real — the fix sketched here may not be the right one by then, and this
list is not everything that will need doing.

**Rate limiter hard-wired to the dev key.** `APP_RATE_LIMITS` in `src/lib/riotClient.ts`
is 20/s and 100/2 min. A production key would still be throttled to those numbers, so it
would change nothing until this does. Riot sends the real limits in `x-app-rate-limit`; an
env var would do too. The engine's pauses (`PAUSE_AFTER_*` in `engine.yml`) were sized to
use a quarter of the dev key and would need the same rethink.

**The ratings replay grows forever.** It replays the whole history three times, in memory,
every hour. `match_rating_rows` is never archived (126 000 matches today), so the phase
grows linearly and will outgrow its 300 s at some multiple of today's volume. Options seen:
incremental with a daily full replay, or moving it off Vercel.

**The publication read ceiling.** 1 000 000 rows per patch; 16.18 was ~490 000 on a dev
key. A patch crawled with a production key can cross it, and the job goes red on purpose.
The way out already written in `data-pipeline.md`: move the rest of `getChampionDetail`
and the combos down to SQL, scoring included. Egress (~72 GB/month of 250) follows the
same curve.

**`patch_options()` scans `matches` on every champion page view.** Those pages are
dynamic (`?patch=`, so their `revalidate` does nothing), and the crawler calls it too.
Measured 77 ms at 126 000 matches, linear in the table. Could be written into a snapshot
by the hourly job.

**The crawler runs inside Vercel functions.** One rate limiter per instance, 300 s per
pass, calls made one at a time. Fine on a dev key; with a key 60× wider the pass itself
becomes the bottleneck. `data-pipeline.md` already expects a standalone worker then.

**Matches stuck incomplete.** A match at `ingested_at` null whose detail 404s is retried at
the head of every crawl pass. Zero such matches today; would need an attempt count or a
status like the timeline fix got.

**Per-IP search limit is per instance.** It stops a burst from one address, not a
distributed one — that would be Vercel's firewall.

**Vercel Hobby forbids commercial use.** Ads or donations mean Pro ($20/month).

**Three lint errors predate the design work.** `react-hooks/set-state-in-effect` in
`Nav.tsx`, `NavSearch.tsx` and `HomeSearch.tsx` (a setState in a mount effect). Harmless
today; `npm run lint` is not clean until they are rewritten.
