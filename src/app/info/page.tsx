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

      <section id="items" className="mt-10 max-w-3xl">
        <h2 className="font-display text-h2 font-semibold text-primary">
          How item tiers are calculated
        </h2>
        <div className="mt-3 space-y-3 rounded-lg border border-subtle bg-raised/40 p-5 text-secondary">
          <p>
            <span className="text-primary">The columns show what happened.</span> Average
            placement, % Top 3, games: raw numbers, exactly as tracked. The tier is the judgement,
            and it is the only thing that corrects for the two ways an item can look better than it
            is. So an S-tier item can show a worse average than an A-tier one — that gap is the
            correction, and it is the useful part.
          </p>
          <p>
            <span className="text-primary">First, surviving.</span> An item only reaches your build
            if the game lasted: players who bought 3 items averaged 3.90, players who bought 6
            averaged 2.48. So an item is compared to players who got equally far — to the same
            purchase for a bought item, to the same number of prismatics for a prismatic, since 94%
            of those come free from anvils rather than the shop. Checked: the same item bought late
            no longer scores better than when bought early.
          </p>
          <p>
            <span className="text-primary">Second, who buys it.</span> Late items are bought by
            stronger players, who place better whatever they buy. Comparing each purchase to
            players of similar rank as well cuts the link between how late an item arrives and how
            it scores from −0.86 to −0.77.
          </p>
          <p>
            It doesn&apos;t reach zero, and it shouldn&apos;t be forced to: part of what remains is
            real — buying an item late is a choice, not an accident. The rest we can&apos;t separate,
            because our own skill rating is too noisy on a single player to subtract cleanly. Rather
            than pretend otherwise, the Legendary list lets you sort by{" "}
            <span className="text-secondary">Better early</span> or{" "}
            <span className="text-secondary">Better late</span> and see the effect item by item.
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
