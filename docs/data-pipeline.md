# The data pipeline

How match data gets from Riot's API to a tier list, and why each part is shaped the way
it is. The code is the source of truth; this note explains the reasoning that isn't
visible from any single file.

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
revalidate every 30 minutes.

Only **two patches are published** — the current one and the previous one. A tier list
from a stale patch is worse than no tier list, since an augment nerfed by 20 % keeps its
old numbers. Older data still feeds player history and the ladder, which legitimately span
everything known.

The patch comes from Riot's own `gameVersion`, not from a guess based on dates: Riot
deploys per region and in stages, so a match carries the version its server was running.
A patch only becomes the default once it has enough matches to stand on; below that
threshold the site stays on the previous one and says so.

## The 300-second ceiling

The whole job has to fit in a single serverless invocation. That single constraint shapes
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

Arena is eight teams of three with a full ranking, so a duel model like Elo doesn't apply.
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

| Service | Free until | What starts billing | Price |
|---|---|---|---|
| GitHub Actions | unlimited (public repo) | never at this scale | — |
| Vercel Hobby | current traffic | commercial use | $20/mo |
| Supabase | 500 MB DB, 5 GB egress | ~59 000 matches raw | $25/mo → 8 GB |
| Supabase compute | Micro (1 GB RAM), included | aggregates over millions of rows | +$15–60/mo |

The trap is that storage is not what costs money ($0.125/GB is negligible) — **compute
is**. A 40 GB database on the included Micro instance would be unusable for aggregation
long before the storage bill mattered.
