import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy & Terms of Service — MetArenaStats",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
        Privacy Policy &amp; Terms of Service
      </h1>
      <p className="mt-2 text-sm text-zinc-500">Last updated September 2026.</p>

      <section id="privacy" className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-100">Privacy Policy</h2>
        <div className="mt-3 space-y-4 text-zinc-400">
          <p>
            MetArenaStats isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or
            opinions of Riot Games or anyone officially involved in producing or managing Riot
            Games properties.
          </p>

          <div>
            <h3 className="font-medium text-zinc-200">What we collect</h3>
            <p className="mt-1">
              When you search a Riot ID (Name#TAG), we fetch your recent League of Legends Arena
              match history from Riot&apos;s official API and store it in our database: Riot ID,
              PUUID, champion, items, augments, kills/deaths/assists, and placement for each
              match. We also store the same data for the other 17 players in those matches, so
              the site&apos;s tier lists and leaderboard grow from every search. We never collect
              passwords, payment details, or anything beyond what Riot&apos;s public match API
              returns.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-zinc-200">Why we collect it</h3>
            <p className="mt-1">
              To build the champion/item/augment tier lists, the Anvil Run stats, and the player
              leaderboard shown on this site. There are no user accounts, no cookies, and no
              analytics or tracking scripts on this site.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-zinc-200">How long we keep it</h3>
            <p className="mt-1">
              Match data is kept indefinitely to power cumulative statistics, unless you ask us to
              remove it (see below) or Riot forwards us a deletion request tied to your account.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-zinc-200">Your data, your call</h3>
            <p className="mt-1">
              Want your Riot ID and match data removed from MetArenaStats? Email{" "}
              <a href="mailto:contact@tblabs.dev" className="text-blue-400 hover:underline">
                contact@tblabs.dev
              </a>{" "}
              and we&apos;ll delete it. We also honor deletion requests Riot forwards to us under
              their player data policies.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-zinc-200">Third parties</h3>
            <p className="mt-1">
              Match data comes from{" "}
              <a
                href="https://developer.riotgames.com/"
                className="text-blue-400 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Riot Games&apos; official API
              </a>
              . It&apos;s stored with Supabase and this site runs on Vercel — neither has access
              to it beyond hosting it on our behalf.
            </p>
          </div>
        </div>
      </section>

      <section id="terms" className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-100">Terms of Service</h2>
        <div className="mt-3 space-y-4 text-zinc-400">
          <p>
            MetArenaStats is a free, community stats and tier-list site for League of Legends
            Arena. There&apos;s no login, no paid tier, and no ads — all core stats stay free, in
            line with Riot&apos;s policies for third-party apps.
          </p>

          <div>
            <h3 className="font-medium text-zinc-200">No warranty</h3>
            <p className="mt-1">
              Stats are computed from whatever matches have been searched so far — they&apos;re
              partial, may contain mistakes, and can change as more data comes in. Don&apos;t
              treat anything here as authoritative or complete.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-zinc-200">Fair use</h3>
            <p className="mt-1">
              Don&apos;t scrape, abuse, or resell data from this site, or attempt to bypass its
              normal usage. We may block traffic that does.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-zinc-200">Changes</h3>
            <p className="mt-1">
              This site, its features, and these terms can change at any time as the project
              evolves.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-zinc-200">Contact</h3>
            <p className="mt-1">
              Questions about these terms or the privacy policy? Email{" "}
              <a href="mailto:contact@tblabs.dev" className="text-blue-400 hover:underline">
                contact@tblabs.dev
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
