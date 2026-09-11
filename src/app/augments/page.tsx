import { getAugmentStats, getAugmentTimingStats } from "@/lib/aggregate";
import { type StatsRow } from "@/components/StatsTable";
import { AugmentViews } from "@/components/AugmentViews";
import type { AugmentTimingRow } from "@/components/AugmentTimingGrid";
import { PageHeader } from "@/components/PageHeader";
import { resolveAugment } from "@/lib/gameData";

export const dynamic = "force-dynamic";

function TimingNote({ baselines }: { baselines: number[] }) {
  return (
    <div className="mb-5 max-w-3xl space-y-1.5 text-small text-muted">
      <p>
        The same augment is a different card in round 1 than in round 8. Each bar is this
        augment&apos;s % Top 3 when it was the player&apos;s 1st, 2nd or 3rd pick; the hairline marks
        the 50% baseline (3 of 6 teams finish top 3). Needs 30 picks in every slot.
      </p>
      <p>
        Only the first three picks are compared. Across all picks, the baseline runs{" "}
        <span className="font-mono tabular-nums text-secondary">
          {baselines.map((b) => `${(b * 100).toFixed(1)}%`).join(" / ")}
        </span>{" "}
        — flat, so the slots are comparable. It climbs steeply after that, because owning a 4th or
        5th augment already means you survived deep into the game. The swing figure subtracts each
        slot&apos;s own baseline.
      </p>
      <p>
        This is not augment <em>levels</em> — Riot&apos;s match API doesn&apos;t expose them (
        <a
          href="https://github.com/riotgames/developer-relations/issues/1157"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          open issue since May 2026
        </a>
        ), so no site built on match history can show level-up value yet.
      </p>
    </div>
  );
}

export default async function AugmentsPage() {
  const [{ totalMatches, augments }, timing] = await Promise.all([
    getAugmentStats(),
    getAugmentTimingStats(),
  ]);

  const rowsByRarity: Record<string, StatsRow[]> = { silver: [], gold: [], prismatic: [] };
  for (const entry of augments) {
    const info = resolveAugment(entry.augmentId);
    const tier = info?.tier ?? "gold";
    const row: StatsRow = {
      key: String(entry.augmentId),
      name: info?.name ?? `Augment ${entry.augmentId}`,
      iconUrl: info?.iconUrl,
      rarity: tier as StatsRow["rarity"],
      games: entry.games,
      top3Rate: entry.top3Rate,
      top1Rate: entry.top1Rate,
      avgPlacement: entry.avgPlacement,
      playRate: entry.playRate,
    };
    (rowsByRarity[tier] ??= []).push(row);
  }

  const timingRows: AugmentTimingRow[] = timing.augments.map((entry) => {
    const info = resolveAugment(entry.augmentId);
    return {
      key: String(entry.augmentId),
      name: info?.name ?? `Augment ${entry.augmentId}`,
      iconUrl: info?.iconUrl,
      rarity: info?.tier as AugmentTimingRow["rarity"],
      totalPicks: entry.totalPicks,
      slots: entry.slots,
      swing: entry.swing,
    };
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader
        eyebrow="Tier list"
        title="Augments"
        description="Which augments win, and when to take them."
        totalMatches={totalMatches}
      />
      <AugmentViews
        rowsByRarity={rowsByRarity}
        timingRows={timingRows}
        timingNote={<TimingNote baselines={timing.baselines} />}
      />
    </div>
  );
}
