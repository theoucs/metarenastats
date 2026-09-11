import { searchPlayerMatches, findKnownPlayerByRiotId } from "@/lib/riotSearch";
import { getPlayerProfile } from "@/lib/aggregate";
import { resolveChampion } from "@/lib/gameData";
import { StatPill, top1Color, top3Color } from "@/lib/statsDisplay";
import { StatsTable, type StatsRow } from "@/components/StatsTable";
import { MatchCard } from "@/components/MatchCard";

export const dynamic = "force-dynamic";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ riotId: string }>;
}) {
  const { riotId: rawParam } = await params;
  const riotId = decodeURIComponent(rawParam);

  const result = await searchPlayerMatches(riotId);

  let puuid: string | null = null;
  let displayRiotId = riotId;
  let liveError: string | null = null;

  if (result.ok) {
    puuid = result.account.puuid;
    displayRiotId = `${result.account.gameName}#${result.account.tagLine}`;
  } else {
    liveError = result.error;
    // Riot lookup failed (most likely our dev key expired) — if this player
    // was searched before, fall back to what we already have instead of a
    // hard error, so the site stays useful even mid key-outage.
    const known = await findKnownPlayerByRiotId(riotId);
    if (known) {
      puuid = known.puuid;
      displayRiotId = known.riotId;
    }
  }

  if (!puuid) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-center sm:px-6 sm:py-12">
        <h1 className="font-display text-h1 font-semibold tracking-tight text-primary">{riotId}</h1>
        <div className="mt-8 rounded-lg border border-subtle bg-raised/40 p-10 text-secondary">
          {liveError ?? "Player not found."}
        </div>
      </div>
    );
  }

  const profile = await getPlayerProfile(puuid);
  const topChampion = profile.champions[0];
  const topChampionInfo = topChampion ? resolveChampion(topChampion.champion) : undefined;

  const championRows: StatsRow[] = profile.champions.map((c) => {
    const info = resolveChampion(c.champion);
    return {
      key: info?.id ?? c.champion,
      name: info?.name ?? c.champion,
      iconUrl: info?.iconUrl,
      games: c.games,
      top3Rate: c.top3Rate,
      top1Rate: c.top1Rate,
      avgPlacement: c.avgPlacement,
      playRate: c.playRate,
    };
  });

  const [gameName, tagLine] = displayRiotId.split("#");

  return (
    <div>
      <div className="relative h-[220px] w-full overflow-hidden bg-raised">
        {topChampionInfo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${topChampionInfo.id}_0.jpg`}
            alt=""
            loading="lazy"
            width={308}
            height={560}
            className="absolute inset-0 h-full w-full object-cover object-top opacity-[0.15]"
          />
        )}
        {/* from-35% guarantees the bottom ~77px is fully opaque — same fix as
            the champion page banner, see comment there. */}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base)] from-35% via-[var(--bg-base)]/85 via-65% to-[var(--bg-base)]/45" />
        <div className="relative mx-auto flex h-full max-w-6xl items-end px-4 pb-10 sm:px-6">
          <div className="flex items-center gap-4">
            {topChampionInfo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={topChampionInfo.iconUrl}
                alt=""
                className="h-16 w-16 rounded-xl border border-subtle object-cover shadow-[var(--elev-2)]"
              />
            ) : (
              <div className="h-16 w-16 rounded-xl border border-subtle bg-raised" />
            )}
            <div>
              <h1 className="font-display text-h1 font-semibold tracking-tight text-primary">
                {gameName}
                <span className="text-secondary">#{tagLine}</span>
              </h1>
              <p className="text-small text-secondary">
                Arena player{topChampionInfo ? ` — mains ${topChampionInfo.name}` : ""}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6 sm:pb-12">
        <div className="-mt-8">
          {liveError && (
            <p className="mt-4 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-muted)] px-4 py-2.5 text-small text-warning">
              Couldn&apos;t refresh from Riot right now ({liveError}) — showing previously saved data.
            </p>
          )}

          {profile.games === 0 ? (
            <div className="mt-8 rounded-lg border border-subtle bg-raised/40 p-10 text-center text-secondary">
              No Arena games found for this player yet.
            </div>
          ) : (
            <>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatPill label="Avg Placement" value={profile.avgPlacement.toFixed(2)} />
                <StatPill
                  label="% Top 1"
                  value={`${(profile.top1Rate * 100).toFixed(1)}%`}
                  colorClass={top1Color(profile.top1Rate)}
                />
                <StatPill
                  label="% Top 3"
                  value={`${(profile.top3Rate * 100).toFixed(1)}%`}
                  colorClass={top3Color(profile.top3Rate)}
                />
                <StatPill label="Games" value={String(profile.games)} />
              </div>

              <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_minmax(0,380px)]">
                <div className="min-w-0">
                  <h2 className="font-display text-h2 font-semibold text-primary">Match History</h2>
                  {result.ok && result.matches.length > 0 ? (
                    <div className="mt-4 flex flex-col gap-3">
                      {result.matches.map((match) => (
                        <MatchCard key={match.matchId} match={match} />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 rounded-lg border border-subtle bg-raised/20 p-3 text-small text-muted">
                      {result.ok
                        ? "No recent Arena games found."
                        : "Live match history is unavailable right now."}
                    </p>
                  )}
                </div>

                <div className="min-w-0">
                  <h2 className="font-display text-h2 font-semibold text-primary">Top Champions</h2>
                  <p className="mt-1 text-small text-secondary">Across this player&apos;s own games.</p>
                  <div className="mt-4">
                    <StatsTable rows={championRows} linkPrefix="/champions/" />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
