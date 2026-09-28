# The data pipeline

How match data gets from Riot's API to a tier list, and why each part is shaped the way
it is. The code is the source of truth; this note explains the reasoning that isn't
visible from any single file.

**Read it top to bottom.** Like `supabase/schema.sql`, it is a journal: sections are
dated and a later one supersedes an earlier one where they disagree. What was replaced is
kept, because the measurement that justified a decision is worth more than the decision.
Two places where that matters: "Publishing" and "The 300-second ceiling" describe a single
hourly invocation, which became two on 2026-09-22; and the read ceiling they assume was
raised on 2026-09-28 (see "The two ceilings").

```
Riot API ──> crawler ──> Postgres ──> hourly job ──> snapshots ──> ISR pages
```

## The only scarce resource is the Riot key

Riot returns its rate limits in the headers of *every* response, which makes them a fact
rather than a guess:

```
x-app-rate-limit:       100:120,20:1   the key: 100 req/2min AND 20 req/s
x-app-rate-limit-count: 3:120,1:1      where we currently stand
x-method-rate-limit:    2000:10        this endpoint only
```

Two counters stack and the stricter one wins. The per-method limits are so wide
(2 000 per 10 s on match-v5) that they are never reached: the real ceiling is the key's
100 requests per 2 minutes.

The app counter is **per regional host** — verified by watching
`europe.api.riotgames.com` sit at `3:120` while `euw1.api.riotgames.com` was at `2:120`.
So there are two separate budgets, and everything living on `euw1` (summoner, spectator)
costs nothing against the match budget on `europe`.

The key is also shared with visitors: a player searching their name spends from the same
budget as the crawler. That constraint drives the next decision.

## Long and slow beats short and violent

The crawler runs on GitHub Actions rather than on Vercel, because runner time is free and
unlimited on a public repository while serverless execution is metered — and because a
crawl is a long, mostly-waiting loop, which is the worst possible shape for a function
billed by the second.

GitHub's scheduler, however, is unreliable: over one 28-hour observation it fired 7 of the
~28 slots it should have. Since triggers can't be made dependable, **one trigger has to
last for hours**. The engine workflow therefore loops on a deadline (170 minutes by
default, 345 maximum) rather than on a number of passes.

Reshaping it that way exposed an older design error — the first version had optimised the
wrong resource:

| | Short bursts | Continuous engine |
|---|---|---|
| Share of the Riot key used | ~50 %, in bursts | **~25 %, continuously** |
| Headroom left for visitors | intermittent | **75 %, at all times** |
| Matches per trigger | 1 200 | **~1 000 + 1 400 timelines** |

Better on both counts at once: more matches per day *and* more headroom at every instant.
A cycle spends 298 calls spread over 20 minutes — 0.25 calls/s against 0.83 allowed. When
two constraints appear to conflict, the question worth asking is which resource is
actually scarce.

Crawling and timeline fetching live in the **same** job because they draw on the same key.
Split across two workflows they stole budget from each other without knowing it: the rate
limiter lives in the memory of each Vercel instance, and no instance sees what another
spends. The ratio of 1 crawl pass per 2 timeline passes is arithmetic, not taste — a crawl
creates 120 matches needing timelines, a timeline pass absorbs 80. It self-regulates: once
the backlog reaches zero, timeline passes return empty in a second.

## Why timelines are a separate pass

`match-v5` returns a participant's **inventory slots**, not the order items were bought
in. Verified on EUW1_7982040680, where Xayah bought Boots → The Collector → Infinity Edge
but whose final inventory lists Boots, Reaper's Toll, Collector, IE. Purchase order only
exists in the match timeline, which is a second request per match.

What the timeline does **not** give is prismatic items: they are never bought in a shop.
Measured on 108 participants — 20 appear in a timeline against 183 actually held. The
reconstructed order therefore covers shop purchases only (boots and legendaries) and
*completes* the final inventory rather than replacing it.

Rebuilding the order from events also means simulating the inventory rather than listing
purchases: an undone purchase (16 occurrences in a single observed game) would otherwise
count as a buy, and a sold item would appear in a build it is no longer part of.

## Publishing

Every page used to aggregate the whole database on load — 3.7 MB of egress per page view
at 900 matches, with a silent truncation past 30 000 rows. Now an hourly job computes each
aggregate once and stores it as a row in `stats_snapshots`; pages read a single row and
revalidate every 30 minutes. *(That job became two invocations on 2026-09-22.)*

Only **two patches are published** — the current one and the previous one. A tier list
from a stale patch is worse than no tier list, since an augment nerfed by 20 % keeps its
old numbers. Older data still feeds player history and the ladder, which legitimately span
everything known — since 2026-09-24 it does so from a summary rather than from the raw
participations (see *Retention* in the README).

Verified in production on 2026-09-24, when 16.19 arrived: the rotation needs no
intervention. `patch_options()` puts the new patch first, the materialized view rebuilds
on the same rule, the snapshots for the patch that fell out are pruned by the job's own
housekeeping, and the site keeps showing the previous patch — and says so — until the new
one clears 300 matches.

The patch comes from Riot's own `gameVersion`, not from a guess based on dates: Riot
deploys per region and in stages, so a match carries the version its server was running.
A patch only becomes the default once it has enough matches to stand on; below that
threshold the site stays on the previous one and says so.

## The 300-second ceiling

*Superseded in part on 2026-09-22 — the job is now two invocations, each with its own
300 s. The three design consequences below still hold.*

The whole job had to fit in a single serverless invocation. That single constraint shapes
most of the data layer:

- **Keyset pagination, by match.** Paging by primary key looked natural, but the patch
  lives in another table, so Postgres had to read the rest of the table and *sort* it to
  serve each page — the cost of one page followed the size of the whole table. Paging by
  `match_id`, with an index on `(patch, match_id)`, makes a page cost only what it returns:
  3 693 ms and 136 063 buffers became 85 ms and 31 377 at equal depth and cache.
- **A materialized view of the published patches.** The participants view is three joins
  deep; a paginated read paid all three on every page — 720 000 buffers to read what costs
  34 000 in a single pass. Freezing it costs one ~20-second concurrent refresh per job.
- **Incremental resume for the rating syncs.** Three functions used to re-scan the entire
  database hourly to find a few hundred new rows: 276 143 buffers to find 10 new players,
  867 680 to update zero counters. They now resume from a timestamped window with a
  two-hour safety margin, and each still runs a full sweep every six hours so a missed row
  cannot survive the day.

## Ratings

Riot exposes no Arena MMR — checked, not assumed. The ladder is therefore computed here.

Arena is six teams of three with a full ranking, so a duel model like Elo doesn't apply.
The rating is Weng-Lin / Plackett-Luce, replayed three times over the full history: a
player's first games are otherwise judged against opponents still sitting at the default
rating, so the result is real but the expectation it is compared against is worthless.
Replaying from the final ratings removes that starting bias — a cheap approximation of
TrueSkill Through Time.

Measured on 12 219 matches, training on 85 % and testing on the 15 % never seen:

| | all duels | players with 3+ games | with 10+ |
|---|---|---|---|
| 1 pass | 50.5 % | 52.4 % | 56.7 % |
| 3 passes | 50.7 % | 53.4 % | **60.2 %** |
| 5 passes | 50.8 % | 53.4 % | 61.7 % |

The gain lands exactly where it matters — on players actually ranked. Three passes capture
most of it and the curve is flat afterwards; taking five would be picking the maximum
observed on the test set, which is a coincidence rather than a measurement.

## What it costs to run

Supabase moved to **Pro** on 2026-09-22, when the free plan's 500 MB was exceeded by 2.4×
and the disk filled: the materialized-view refresh had nowhere to write its temporary
files, and publishing stopped. The trap that makes it urgent rather than gradual is that
**a full disk cannot be recovered from in place** — `vacuum full` needs as much free space
as the table it rewrites, and a `delete` returns nothing to the disk. Dropping an index
is the only thing that frees space immediately.

| Service | Included | What starts billing | Price |
|---|---|---|---|
| GitHub Actions | unlimited (public repo) | never at this scale | — |
| Vercel Hobby | current traffic | commercial use | $20/mo |
| Supabase Pro | 8 GB disk, 250 GB egress, $10 compute credit | disk or egress above those | $25/mo |
| Supabase compute | Micro, covered by the credit | a second project, or a larger size | Small +$5/mo net |

Two things were measured rather than assumed. The project ran on **Nano** compute while
being billed at Micro price — Pro includes the upgrade for free, and the dashboard says so
in a dismissable popup. On Nano the database became unreachable for an hour under two
catch-up autovacuums. And the compute line is **not covered by the spend cap**, unlike
disk and egress; since sizes only change by hand, that is a fact to know rather than a
risk to manage.

Storage is not what costs money — $0.125/GB is negligible. Compute is, and egress after
it: each publication used to pull ~400 000 rows out of Postgres, which is what the SQL
migration below is really about.

## Compressing the participations (2026-09-22)

`match_participants` was 720 MB of a 1 218 MB database. Measured on 20 000 rows, a
participation weighed 322 bytes, of which **79 were the puuid** — repeated on every row,
while `players` already mapped it to an integer and `match_rating_rows` already used that
integer. Those 79 bytes were also why the unique index on (match_id, puuid) was 208 MB,
the single largest object in the database.

The table was rebuilt rather than altered: adding a column and filling it would leave a
dead version of every row, so the table would double before shrinking — and `vacuum full`,
which reclaims it, needs that space again. Writing the final shape costs it once.

    bytes/row     322 → 186
    total      1 273 MB → 390 MB
    database   1 751 MB → 932 MB

Not done, and on purpose: `match_id` text → integer (~15 MB) touches the foreign key, the
crawler and the timeline fetcher; `champion` → smallint (~7 MB) would need a lookup table,
so the database would stop describing itself. The first two lines of the ledger carry 90 %
of the gain for 20 % of the risk.

## Splitting the hourly job (2026-09-22)

The job did two jobs in one 300-second invocation: replaying the ratings, then publishing.
Measured once the disk was freed — mmr 96 s, promote 167 s, then the timeout, with the
materialization (~92 s) and the aggregations (~150 s) never reached.

They meet at exactly one point: the materialized view freezes the skill tier the ratings
pass just wrote. So the order matters and the simultaneity does not, because the state
lives in the database between them. Split into `?only=ratings` then `?only=snapshots`,
each gets its own 300 s.

`promote_tracked_players` was the 167 s: a full join between `crawl_queue` and `players`
on a 79-byte puuid, whose hash table did not fit in the 2.1 MB of `work_mem` and spilled to
disk — to promote, most hours, nobody at all. A `materialized` CTE forces the small side
first; the function carries its own `work_mem`. **166 s → 0.8 s.**

## Moving the aggregation into Postgres (2026-09-24 → 28)

The principle: **SQL groups, JavaScript scores.** What goes down is the reduction — 400 000
participations to 173 counters. What stays up is everything that took measurement to get
right: the landmark-bias correction, the shrinkage, the tier k-means. Rewriting those in
SQL would risk wrong numbers for no gain, since arithmetic on a few hundred rows is free.
So the functions return **raw counters, never rates**, and `toStat` remains the only place
in the codebase where a rate is computed.

Down in Postgres: champion stats, augment stats, team-comp archetypes and coverage, the
four anvil aggregates, augment timing, the item acquisition grid with its landmark
baselines, and per-champion augments. Reference data (item categories, augment rarities,
champion roles) lives in `ref_items` / `ref_augments` / `ref_champions`, *generated* from
`src/lib/data/*.json` by `npm run sql:reference` — never hand-written, or it would diverge
at the first patch.

Still in JavaScript: the rest of `getChampionDetail` (items, build slots, anvil subsets)
and the combo pairs. Measured, and this is the part worth knowing: moving them would **not
help**. A per-champion item grid is 234 711 rows against 491 652 participations — half the
rows, twice the width, a wash on transport. The win would have to come from moving the
*scoring* down too, which is a separate piece of work.

The pairs are the same story from the other end. `combo_stats()` is written and verified,
and it is **not wired**: 36.8 s in SQL against ~8 s in JavaScript on the same patch, and
~320 s extrapolated to a full patch — for a 300 s budget. The answer there was not the
language but the **cadence**: an item pair does not change value in sixty minutes, so they
are recomputed once a day. Aggregation 38 s → 29 s.

## The two ceilings, and what they are worth

**Read ceiling.** `MAX_PAGES × PAGE_SIZE` bounds how many rows one patch may return; past
it the read truncates and the job goes red. It was 600 000, set on an estimate written in
the code — "≈ 120 MB in JS memory", or 200 bytes per row. Measured in production on
504 069 rows actually loaded: **439 bytes per row**, 211 MB after the read, against a V8
heap limit of **2 036 MB**. The estimate was 2.2× optimistic; it could as easily have been
wrong the other way, which is what makes that kind of number dangerous. Raised to
1 000 000 rows per patch — the job holds *both* published patches at once, so the worst
case is twice that, ~950 MB, under half the ceiling.

**Egress.** Each publication pulls the published patches out of Postgres: ~72 GB/month,
against 5 GB on the free plan and 250 GB on Pro. This is the number the SQL migration
actually reduces.

## Silent truncation, twice

PostgREST caps every response at `pgrst.db_max_rows` — 20 000 here — and **says nothing**
when it cuts. `champion_augment_stats` returns 27 851 rows; 20 000 were published and
7 851 vanished, leaving the champions past the cut with short augment tabs and no error
anywhere. Every SQL-function read now paginates and stops only on an *incomplete* page,
which is the only proof there was nothing left: a full page is never an ending, it is a
suspicion.

The same shape had already been fixed for the participation read ("truncation is no longer
mute") and simply had not been applied to functions, because they used to return short
lists. `item_acquisitions` sits at 6 903 rows and will triple with the patch.

## Verifying a rewrite

`npm run verify capture <file>` then `npm run verify compare <file>` publishes and diffs
the snapshots **structurally** — walking both documents and comparing the leaves it finds,
naming no field. That property is the whole point: a comparison that names fields can
silently find none. It refuses to conclude when the leaf count is zero, refuses to run
while the crawler is live, and its `capture` mode publishes twice and demands the two be
identical — if the environment moves, no later comparison means anything.

Three rewrites were validated on comparisons that measured something adjacent to what
mattered: fields that did not exist (so `NULL` against `NULL`), two publications with a
ratings pass between them (which rewrites the skill tiers the landmark references depend
on), and a function checked in the database rather than through the path the application
takes. All three answered "zero differences", and all three were wrong.

## Crawling for the patch that needs it (2026-09-28)

Measured on 25 September: of 10 820 matches ingested that day, **7 742 belonged to patches
already archived** and 360 to the current one. `by-puuid/ids` returns a player's last 100
Arena games with no date bound, and 315 000 of the 330 000 queued players had never been
visited — so each first visit paid for a full history, mostly on patches no tier list reads.

Three changes, each aimed at a different leak:

- **Discovery is bounded to the current patch** (`startTime` = its first known game).
  Tracking keeps full histories, because the ratings are the one reader of old matches.
- **A pass ingests newest first.** Tracked players are read first and their histories used
  to fill the 120-match cap before discovery got a turn. Match ids are issued in order, so
  sorting them costs nothing.
- **The queue serves recently discovered players first** among the never-visited: they came
  out of recent games, so they still play.

Two follow-ups, once the first passes were measured. At 15 players a pass found only 40
current-patch matches for 120 places — a player bounded to the current patch brings a few
days of games — so a pass now reads **30 players**: one call each, not a hundred. And a
pass had become cheap (~80 calls: 30 histories and ~50 matches, against 151 before), so
the engine runs **two crawl passes per cycle**: ~260 calls with their timelines, still
under the 313 the cycle was sized for, which keeps the visitors' share of the key.

Share of the current patch among ingested matches, same morning:

| | matches | 16.19 | 16.18 | archived patches |
|---|---|---|---|---|
| before | 499 | 18 % | 34 % | 48 % |
| bounded discovery, 15 players | 240 | 39 % | 40 % | 21 % |
| 30 players | 170 | 98 % | 2 % | 0 % |

The last row covers a single hour; the throughput per day is still to be measured.

The default-patch threshold moved from 300 to **5 000 matches** the same day, on a
measurement rather than a guess: a new patch's sample correlates with its own eventual
tier list at 0.48 at 750 matches, 0.76 at 3 000 and 0.82 at 6 000 — while the *previous*
patch predicts it at 0.80–0.90 across three measured pairs. Below ~5 000, the old patch
is the better description of the new one. The table is in `src/lib/patches.ts`.

## Archiving becomes a job step (2026-09-28)

The first archiving (24 September) was done by hand, a patch at a time, with
`roll_up_patch` then `drop_patch_participations`. Two things made that unfit to automate.
It *replaced* a patch's totals rather than adding to them, while the crawler kept
bringing matches from archived patches — 263 000 participations by the 28th, which
re-running it would have turned into the whole archive of their patch. And nothing
recorded *which* matches had been archived, so a player search, which re-saves the last
twenty games it reads, could give an archived match its participations back.

The unit is now the match. `archive_old_matches(n)` takes matches outside the two
published patches whose rating row is built, deletes their participations *returning*
them, counts those (with the same AFK exclusion as `participants_clean`), adds the
counters to `player_champion_totals` and stamps `archived_at` — one statement, so no row
can be deleted without being counted. `persistMatches` skips archived matches.

The check was exact rather than approximate, because each match's rating row lists the
participants it counted: across the 14 637 matches of the first run, the archive grew by
262 824 games, 918 210 placement points, 43 902 top-1s and 131 754 top-3s, and the rating
rows of those matches sum to the same four numbers.

It runs in the ratings phase, after `sync_match_rating_rows`, in batches of 5 000 matches
(~25 s each) until 150 s into the phase. A patch rollover — ~30 000 matches — clears in a
few hourly passes.

The same day, timeline passes were restricted to the published patches: once the recent
backlog is clear they were spending calls on the purchase order of archived matches,
which the archive does not keep.

**What archiving silently broke.** After the 24 September pass, `participants_clean`
only holds the published patches — and `leaderboard_top` was still counting each
player's games there. For four days the leaderboard showed its #1 at 4 games and 1.00
instead of 35 and 1.37, and dropped every ranked player without a recent game (911 rows
instead of 1 000). No error anywhere: the query was right for the data it used to see. It
now reads the career counters `player_ratings` already holds, like the leaderboard
search. Any reader of `participants_clean` or `match_participants` that means "a
player's whole history" is wrong since that date. The two known whole-history readers
are built for it (player profile: archive + live; ratings: `match_rating_rows`); an audit
should still grep for the others.

**Not yet verified in production (archiving and crawl, above):**
- a full patch leaving the window (16.18, when 16.20 lands around 8 October): after a few
  hourly passes, no 16.18 row should remain in `match_participants`;
- a whole day of crawling with two passes of 30 players — matches per day on the current
  patch, and whether visitor searches still get through;
- the freed space is reused, not returned to the disk (no `vacuum full`: not worth
  rewriting the table at 12 % of the disk used).

## Audit fixes (2026-09-28)

**One heavy phase at a time.** The engine and the hourly safety net each had their own
GitHub concurrency group, so nothing stopped two `ratings` phases from overlapping — and
that phase ends by deleting every `player_ratings` row older than *its own* stamp. If the
other pass wrote in between, its rows went, and the ladder could sit empty until the next
hour. A shared concurrency group would have made the safety net wait out the engine's
5 h 30. So the route takes a lease in `job_locks` (`try_job_lock`, 320 s, just past a
function's 300 s so a killed invocation blocks nothing for long); a phase that finds it
taken answers `skipped: "busy"` with a 200. Not `pg_advisory_lock`: PostgREST serves each
request on a pooled connection, so a session lock would not outlive the call that took it.

**The queue now counts failures.** `crawl_queue` was filtered on `error_count < 5` from day
one, but nothing ever incremented it — 0 of 346 000 rows carried one. A puuid failing for
good was never marked visited, so it stayed at the head of the queue and cost a call every
pass. A player-side failure (anything but 429/401/403) now bumps the counter and sends the
player to the back; a success resets it. A timeline Riot answers 404 for is marked fetched,
with `item_order` left null, instead of being re-requested forever. Still open: a match
stuck at `ingested_at` null whose detail 404s is retried every pass (0 such matches today).

**Visitor search.** The known-player fallback was an unindexed `ilike` over `players`
(4.6 s); it is now `find_player_by_riot_id`, an equality on an index over `lower(riot_id)`
— 0.1 ms. A player page costs ~32 Riot calls and is never cached, so `robots.txt` keeps
crawlers off `/players/` and `/api/`, and a search is capped at 5 per IP per 2 minutes
(per instance, in memory — it stops a burst, not a distributed attack; beyond that, it
falls back to stored data like an expired key does).

What the same audit found but left for later — mostly what a production key and more data
will bring — is noted in `docs/later.md`.

## Placements and patch movers (2026-09-28)

**Placement distribution.** `champion_stats` now also returns `placement_counts`, games
finished at each place 1 to 6, from the same scan as the other counters: measured as its own
query it cost 386 ms per patch, folded in it costs next to nothing. The champion snapshot
carries it as `placements`; the tier list draws it as a six-bar sparkline and the champion
page as a chart. Champions only: items and augments would need their own queries.

**Movers, and why most of the idea was dropped.** The plan was an ↑/↓ arrow per row against
the previous patch. Measured on five patch pairs (16.13 → 16.18, rollup data): a champion's
avg placement moves by ±0.1 to 0.3 between patches, against a standard error of 0.05 to
0.08. At two standard errors about ten of 173 champions "move" every patch, roughly what
chance alone produces. At three, 0 to 4 remain (chance makes half of one). Only those are
kept, in a `movers@<patch>` snapshot written by the hourly job from
`previous_patch_champion_totals`, which reads the previous patch from the published
participations if it is still there, from `player_champion_totals` otherwise, never both
(during archiving a match can be in both). 16.17 → 16.18 had none. The standard error uses
σ = √(35/12), a uniform over six places, which matches the per-champion spread measured on
16.18 (~1.7). Pages read that snapshot without a compute fallback: an absent snapshot means
"nothing to report", not "re-read 500,000 rows".

## The clock moves to the database (2026-09-28)

GitHub's scheduler kept being the weak link: on 28/09 it served no slot between 09:35 and
17:00, so crawling stopped when the morning's engine ended (16:02) and nothing published
either. A `workflow_dispatch`, by contrast, starts within seconds. So Postgres now keeps the
time: `pg_cron` runs `ops.dispatch_workflow('engine.yml')` at :09 and
`ops.dispatch_workflow('refresh-stats.yml')` at :17 every hour, which asks GitHub's API to
start the workflow (`pg_net`, answer 204 when accepted). The GitHub `schedule:` entries stay
as a backup; the `riot-api` concurrency group turns a second engine trigger into a queued run
that starts when the current one ends, which is exactly continuous coverage.

The token is a fine-grained GitHub token limited to this repository and to Actions
read/write, stored in the Supabase Vault as `github_dispatch_token` (never in the repo). It
expires (a year at most, so by 2026-09-28 + 1 year): when it does, the dispatches start
answering 401 and the site falls back to GitHub's own schedule. To check:

```sql
select status_code, created from net._http_response order by id desc limit 5;  -- 204 = ok
select jobname, status, start_time from cron.job_run_details order by start_time desc limit 5;
```

To renew: create a new token with the same scope and replace the secret's value in the
Supabase dashboard (Integrations → Vault). `ops` is a private schema, not exposed by PostgREST,
and the function is revoked from `anon` and `authenticated`.
