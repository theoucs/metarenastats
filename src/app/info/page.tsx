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
        <div className="mt-3 space-y-3 rounded-lg border border-subtle bg-raised/40 p-5 text-secondary">
          <p>
            Every player carries an Arena MMR that moves after each game. How much it moves
            depends on who you were up against and who you had with you: beating the strongest
            teams in the lobby is worth far more than beating the weakest, and a 1st carried by
            two strong teammates is worth less than the same 1st carried by you. All six
            placements move it, not just the top half.
          </p>
          <p>
            The rank is that MMR mapped onto the ranked ladder. Challenger is the top 10 players
            and Grandmaster the next 15 — fixed, so the title doesn&apos;t dilute as the site
            grows. Master is the top 1%, and every tier below follows the same distribution as
            ranked. A rank appears after 5 tracked games; below that the rating hasn&apos;t had
            enough to go on, and we say so rather than guess.
          </p>
          <p>
            This is our own rating, not Riot&apos;s hidden one — Riot doesn&apos;t expose Arena
            MMR anywhere. It&apos;s computed only from the games we track, so it ranks you among
            tracked players, not across EUW. It also sharpens on its own: the more games we have
            per player, the more the rating reflects skill rather than luck.
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
