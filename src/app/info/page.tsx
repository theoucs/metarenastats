import { PageHeader } from "@/components/PageHeader";

export default function InfoPage() {
  return (
    // Container matches every other page so the left edge doesn't jump on
    // navigation; the prose inside stays bounded to a readable measure.
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader eyebrow="Help" title="Info & Tips" />

      <section className="max-w-3xl">
        <h2 className="font-display text-h2 font-semibold text-primary">
          How is the leaderboard calculated?
        </h2>
        <div className="mt-3 rounded-lg border border-subtle bg-raised/40 p-5 text-secondary">
          <p>
            <span className="rounded-full border border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] px-2.5 py-0.5 text-micro text-accent">
              Coming soon
            </span>
          </p>
          <p className="mt-3">
            The exact ranking methodology is still being decided. Right now the leaderboard is
            sorted by raw win rate (top-3 finish out of 6 teams), which is a placeholder. It will
            likely account for games played, opponent strength, and recency once we have enough
            data.
          </p>
        </div>
      </section>

      <section className="mt-10 max-w-3xl">
        <h2 className="font-display text-h2 font-semibold text-primary">Tips</h2>
        <div className="mt-3 rounded-lg border border-subtle bg-raised/40 p-5 text-secondary">
          <p>Tips content coming soon.</p>
        </div>
      </section>
    </div>
  );
}
