# MetArenaStats

Statistics for **League of Legends: Arena** — champion, item, augment and team-composition
tier lists, per-champion build pages, and a player ladder, all computed from matches
crawled continuously from the Riot API.

**Live: [metarenastats.tblabs.dev](https://metarenastats.tblabs.dev)**

![Champion tier list](docs/screenshot.png)

Riot publishes no Arena leaderboard and no aggregate statistics for the mode. Everything
here is derived from raw match data: the site crawls matches, walks the player graph it
discovers, and recomputes every tier list once an hour.

Current scale: **123 000 matches**, **2.2 M participations**, **330 000 players seen**,
**100 000 ranked** — as of 2026-09-28.

Only the two published patches keep their participations row by row (776 000 of them);
older patches are summarised to one row per player and champion, which is all the player
pages read from them. See *Retention* below.

## How it works

```
Riot API ──> crawler ──> Postgres ──> hourly job ──> snapshots ──> ISR pages
             (GitHub      (Supabase)   (two Vercel    (one JSON     (Next.js)
              Actions)                  functions)     per view)
```

- **Crawler** — a GitHub Actions loop calls a cron route on the site, which fetches
  matches under Riot's rate limits and expands the player graph outwards from the players
  it already knows. A second pass pulls each match's timeline, which is the only source
  for *purchase order* (the match endpoint returns inventory slots, not the order items
  were bought in).
- **Hourly job** — two invocations, because their sum no longer fits in one. The first
  replays the player ratings and promotes newly-tracked players; the second reads the two
  published patches, recomputes every aggregate and writes each result as a row in
  `stats_snapshots`. They talk to each other only through the database — the second
  freezes the skill tiers the first just wrote — so the order matters but the timing
  doesn't.
- **Aggregation** — most of it now runs *in* Postgres and returns counters, not rates:
  champions, augments, team comps, anvil runs, augment timing, and the item landmark
  grid. What stayed in JavaScript is what needed thought rather than time — the
  landmark-bias correction, the tier k-means, the shrinkage — because once an aggregate
  is a few hundred rows, the arithmetic is free.
- **Pages** — every page serves a precomputed snapshot and revalidates every 30 minutes,
  so no page load ever aggregates the database.

The whole job has to fit in a single 300-second serverless invocation, which is the
constraint that shapes most of the data layer: keyset pagination, a materialized view
restricted to the published patches, incremental resume for the rating syncs.

## The parts worth reading

Arena statistics are unusually easy to get wrong, because the obvious measurement is
almost always biased. Three examples, each documented in the code where it lives:

**Items inherit the placement of games that lasted** — [`src/lib/aggregate.ts`](src/lib/aggregate.ts).
A sixth item only exists in a game that went long enough to buy six items, so late items
look strong for reasons that have nothing to do with the item. Measured on the sample:
average placement goes from 3.90 at three items to 2.48 at six. Worse, late items are
bought by *better players* (correlation 0.556 between purchase slot and buyer rating), and
those players place better whatever they buy (−0.720). The fix is landmark analysis, the
standard correction for immortal-time bias in epidemiology: every acquisition is compared
only to other acquisitions at the same point in the build *and* the same player skill band.
Displayed columns stay raw — only the tier carries the correction, because a column
labelled "Avg Placement" must state what actually happened.

**Tiers** — [`src/lib/tiers.ts`](src/lib/tiers.ts). Metrics are shrunk toward the batch
mean in proportion to how little evidence backs them, combined 60 % average placement /
20 % top-1 / 20 % top-3, then grouped into bands by 1-D k-means rather than forced
quintiles, so a tier boundary lands on a real gap in the distribution instead of an
arbitrary 20 % cut. The shrinkage anchor has a floor: it used to self-calibrate to the
batch, which meant that on a single champion's augments — where every sample is small —
it stopped protecting anything, and two-game outliers reached the top five.

**Player ratings** — [`src/lib/rating.ts`](src/lib/rating.ts),
[`src/lib/playerRatings.ts`](src/lib/playerRatings.ts). Arena is eight teams of three with
a full ranking, not a duel, so Elo doesn't apply. This is a Weng-Lin / Plackett-Luce
rating computed in-house, replayed three times over the full history — a cheap
approximation of TrueSkill Through Time, which removes the bias of judging a player's
first games against opponents still sitting at the default rating. Measured on a held-out
15 % of matches, prediction accuracy for players with 10+ games goes from 56.7 % with one
pass to 60.2 % with three; the curve is flat after that.

[`supabase/schema.sql`](supabase/schema.sql) is the other file worth opening: every index
and every function carries the measurement that justified it.

## Retention

Raw participations are kept only for the two published patches. Everything older is
summarised into one row per (player, champion, patch) holding **raw counters** — games,
top-1s, top-3s, placement sum — never averages, because an average cannot be added back.
A player's career page sums the archive and the live rows, and lands on exactly the
figure it showed before the archiving.

This is bounded storage, not cheap storage. Measured on the first pass: 271 bytes per raw
participation against 119 per archived row, a factor of **2.3** — far less than the six I
first estimated, because grouping by (player, champion) consolidates almost nothing. Most
players in the sample are seen once and never replay the same champion. The saving comes
from dropping the augment, item and purchase-order columns, not from merging rows: it is
compression of width, not of height.

What matters more than the factor is that `match_participants` stops growing without
bound. Two patches, and that is all.

**Known gap.** The crawler keeps backfilling matches on patches that were already
archived — 269 000 raw participations belong to them today, read by nothing. The
published figures stay correct (the archive holds what was deleted, the raw table holds
the rest, every game counted once), but re-running `roll_up_patch` on such a patch would
*replace* its totals with only the newly-crawled subset rather than add to them. Archiving
is a deliberate, one-at-a-time operation for now, not a job step.

## Stack

Next.js 16 (App Router, React 19, TypeScript, Tailwind v4) on Vercel · Postgres on
Supabase, reached through PostgREST · GitHub Actions for scheduling · no ORM, no state
manager, no component library.

## Running it locally

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev
```

| Variable | Used for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | database access (server-side only) |
| `RIOT_API_KEY` | crawling and player search |
| `CRON_SECRET` | authenticates the cron routes |

The database is described by three files. [`supabase/schema.sql`](supabase/schema.sql) is
a journal, read top to bottom: every index and every column carries the measurement that
justified it, including the ones that were later replaced.
[`supabase/functions.sql`](supabase/functions.sql) holds the SQL functions and is
*dumped* from the live database by `npm run sql:dump` — never edited by hand, so it
cannot drift. `supabase/migrations/` holds the one-off operations, each with its
reasoning.

Applying them to an empty project is not a supported path today: the journal records how
the schema got here, not a replayable script. Without a database the site builds and
renders, but every page is empty.

## Layout

```
src/app/        routes — tier lists, champion pages, player pages, cron endpoints
src/components/ shared UI (tiered tables and grids, tooltips, patch switch)
src/lib/        aggregation, tiers, ratings, Riot client, crawler, snapshots
supabase/       full schema: tables, views, indexes, SQL functions
docs/           architecture notes
scripts/        tooling (game data refresh, patch boundaries, screenshots, key check)
```

Code comments and commit messages are in French; the product and the public API are in
English.

---

Not endorsed by Riot Games. League of Legends and Riot Games are trademarks or registered
trademarks of Riot Games, Inc.
