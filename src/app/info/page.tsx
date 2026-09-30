import { PageHeader } from "@/components/PageHeader";

/** One topic: a title, a few short lines, and the formulas under them. */
function Topic({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8 max-w-3xl scroll-mt-24 first:mt-0">
      <h3 className="font-display text-h2 font-semibold text-primary">{title}</h3>
      <div className="mt-3 space-y-3 rounded-lg border border-subtle bg-raised/40 p-5 text-secondary">
        {children}
      </div>
    </section>
  );
}

/** Formulas, one per line. Scrolls sideways on a phone rather than wrapping
 *  mid-expression. */
function Formula({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-subtle bg-inset px-3 py-2 font-mono text-small leading-relaxed text-primary">
      {children}
    </pre>
  );
}

export default function InfoPage() {
  return (
    // Container matches every other page so the left edge doesn't jump on
    // navigation; the prose inside stays bounded to a readable measure.
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader title="Info & Tips" />

      <h2 className="font-display text-h1 font-semibold text-primary">Info</h2>
      <div className="mt-5">
        <Topic title="Where the data comes from">
          <p>
            Real Arena games on EUW, read from Riot&apos;s API and refreshed every hour. Tier lists
            cover one patch at a time; the leaderboard covers every game we have.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>A new patch becomes the default once it has 5,000 matches.</li>
            <li>
              Teams with an AFK player are removed: their placement is a 2v3, not a performance.
            </li>
          </ul>
        </Topic>

        <Topic title="The numbers in every table">
          <p>
            A game has 6 teams, so the average player finishes 3.5, lands top 3 in 50% of games and
            wins 16.7%.
          </p>
          <Formula>
            {`Avg Placement = sum of placements ÷ games
% Top 3       = top-3 finishes ÷ games
% Top 1       = wins ÷ games
Play rate     = games ÷ matches on the patch`}
          </Formula>
          <p>Green and red are relative to the list you&apos;re looking at, not to a fixed scale.</p>
        </Topic>

        <Topic title="Tiers (S to D)">
          <p>
            <span className="text-primary">1. Small samples are pulled toward the average.</span> A
            pick with 3 games at 1.00 shouldn&apos;t beat one with 500 games at 2.80.
          </p>
          <Formula>
            {`adjusted = (games × value + k × average)
           ÷ (games + k)
k        = the list's median games, min. 50`}
          </Formula>
          <p>
            <span className="text-primary">2. One score per row.</span> Each part is scaled from 0
            to 1 within the list.
          </p>
          <Formula>
            {`score = 60% Avg Placement
      + 20% % Top 1 + 20% % Top 3
      + up to 0.2 for volume (log of games)`}
          </Formula>
          <p>
            <span className="text-primary">3. Tiers follow the gaps.</span> Rows with near-identical
            scores stay together, then each group is placed by its distance to the list&apos;s average
            score (σ = standard deviation).
          </p>
          <Formula>
            {`S  ≥ +0.84σ      A  ≥ +0.25σ
B  within ±0.25σ
C  ≥ −0.84σ      D  below`}
          </Formula>
          <p>Team Comps get no volume bonus: common class trios are common by construction.</p>
        </Topic>

        <Topic id="items" title="Item tiers">
          <p>
            The columns show what happened. The tier corrects two biases, so an S-tier item can show
            a worse average than an A-tier one.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-primary">Surviving.</span> A 6th item only exists if the game
              lasted: players with 3 items average 3.90, players with 6 average 2.48. Prismatics
              are compared by how many the player holds.
            </li>
            <li>
              <span className="text-primary">Who buys it.</span> Late items are bought by stronger
              players, who place better whatever they buy.
            </li>
          </ul>
          <Formula>
            {`tier value = item's result
           − result of players at the same
             purchase number and similar rank`}
          </Formula>
          <p>
            On the Legendary list, <span className="text-primary">Better early</span> and{" "}
            <span className="text-primary">Better late</span> compare the same item bought early and
            bought late.
          </p>
        </Topic>

        <Topic title="What changed since last patch">
          <p>
            A champion appears only if its Avg Placement moved by more than chance explains. Most
            patches have zero to four.
          </p>
          <Formula>
            {`shown if  |avg now − avg before| > 3 × SE
SE = 1.71 × √(1 ÷ games now
            + 1 ÷ games before)`}
          </Formula>
        </Topic>

        <Topic title="Combos, Team Comps, Anvil Run">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-primary">Combos</span>: two items or augments taken by the same
              player in the same game. Needs 5 games.
            </li>
            <li>
              <span className="text-primary">Team Comps</span>: the three classes of a team (e.g.
              Tank + Mage + Marksman), counted on every team of every match. Needs 20 teams.
            </li>
            <li>
              <span className="text-primary">Anvil Run</span>: games finished with stat anvils only,
              no items bought.
            </li>
          </ul>
        </Topic>

        <Topic title="Leaderboard and MMR">
          <p>
            Our own rating, not Riot&apos;s: Riot doesn&apos;t expose Arena MMR. It ranks you among the
            players we track.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Everyone starts at 25. All six placements move it, not just the top half.</li>
            <li>A team&apos;s strength is the sum of its three players.</li>
            <li>Beating stronger teams is worth more. Winning with stronger teammates is worth less.</li>
            <li>The fewer games we have on you, the more each one moves you.</li>
          </ul>
          <Formula>
            {`team strength = MMR₁ + MMR₂ + MMR₃
expected      = odds of that placement,
                given the 6 team strengths
MMR change    ∝ (result − expected)
                × your uncertainty`}
          </Formula>
          <p>
            <span className="text-primary">Teammates MMR</span> and{" "}
            <span className="text-primary">Opponents MMR</span> are the average MMR of your 2
            teammates and of the 15 other players, over all your tracked games.
          </p>
          <p>A rank appears after 5 tracked games.</p>
          <Formula>
            {`Challenger   top 10
Grandmaster  next 15
Master       top 1%
then, of everyone left:
Diamond 4% · Emerald 13% · Platinum 18%
Gold 24% · Silver 21% · Bronze 16%
Iron 3%`}
          </Formula>
        </Topic>
      </div>

      <h2 className="mt-12 font-display text-h1 font-semibold text-primary">Tips</h2>
      <div className="mt-5 max-w-3xl rounded-lg border border-subtle bg-raised/40 p-5 text-secondary">
        <p>Tips content coming soon.</p>
      </div>
    </div>
  );
}
