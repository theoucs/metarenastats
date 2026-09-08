import { getChampionStats } from "@/lib/aggregate";
import { StatsTable, SampleSizeBadge, type StatsRow } from "@/components/StatsTable";
import championsData from "@/lib/data/champions.json";

// Case-insensitive: Riot's match API returns "FiddleSticks" while Data Dragon's
// champion id is "Fiddlesticks" — a known casing mismatch specific to that champion.
const championsById = new Map(championsData.map((c) => [c.id.toLowerCase(), c]));

export const dynamic = "force-dynamic";

export default async function ChampionsPage() {
  const { totalMatches, champions } = await getChampionStats();

  const rows: StatsRow[] = champions.map((c) => {
    const info = championsById.get(c.champion.toLowerCase());
    return {
      // Use Data Dragon's canonical casing as the key so search-result anchor
      // links (which are built from the same reference data) land on the
      // right row — falls back to the raw value if we don't recognize it.
      key: info?.id ?? c.champion,
      name: info?.name ?? c.champion,
      iconUrl: info?.iconUrl,
      games: c.games,
      winRate: c.winRate,
      avgPlacement: c.avgPlacement,
    };
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Champion Tier List</h1>
      <p className="mt-2 text-zinc-400">
        Win rate and average placement across tracked Arena games, ranked highest win rate first.
      </p>
      <div className="mt-4 mb-6">
        <SampleSizeBadge totalMatches={totalMatches} />
      </div>
      <StatsTable rows={rows} />
    </div>
  );
}
