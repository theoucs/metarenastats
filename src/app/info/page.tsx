export default function InfoPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-h1 font-semibold tracking-tight text-primary">Info &amp; Tips</h1>

      <section className="mt-8">
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

      <section className="mt-10">
        <h2 className="font-display text-h2 font-semibold text-primary">Tips</h2>
        <div className="mt-3 rounded-lg border border-subtle bg-raised/40 p-5 text-secondary">
          <p>Tips content coming soon.</p>
        </div>
      </section>
    </div>
  );
}
