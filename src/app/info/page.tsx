export default function InfoPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Info &amp; Tips</h1>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">How is the leaderboard calculated?</h2>
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 text-zinc-400">
          <p>
            <span className="rounded-full border border-blue-900/50 bg-blue-950/40 px-2.5 py-0.5 text-xs text-blue-300">
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
        <h2 className="text-lg font-semibold text-zinc-100">Tips</h2>
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 text-zinc-400">
          <p>Tips content coming soon.</p>
        </div>
      </section>
    </div>
  );
}
