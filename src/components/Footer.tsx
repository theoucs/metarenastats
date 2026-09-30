import Link from "next/link";

// Riot requires this exact disclaimer to be displayed prominently on any
// third-party app using their API — see developer.riotgames.com/policies/general.
export function Footer() {
  return (
    <footer className="border-t border-subtle px-4 py-6 text-center sm:px-6">
      <p className="mx-auto max-w-2xl text-micro text-muted">
        MetArenaStats isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or
        opinions of Riot Games or anyone officially involved in producing or managing Riot Games
        properties. Riot Games and League of Legends are trademarks or registered trademarks of
        Riot Games, Inc.
      </p>
      {/* Also in the top nav; kept here under the page's own name. */}
      <p className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-small">
        <Link href="/info" className="text-accent hover:underline">
          Info &amp; Tips
        </Link>
        <Link href="/privacy" className="text-accent hover:underline">
          Privacy Policy &amp; Terms of Service
        </Link>
      </p>
    </footer>
  );
}
