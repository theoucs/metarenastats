import { getSiteStats } from "@/lib/aggregate";
import { HomeSearch } from "@/components/HomeSearch";
import { LogoMark } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { totalMatches, totalChampions, totalPlayers } = await getSiteStats();

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
        <div className="mt-[-120px] h-[480px] w-[680px] rounded-full bg-blue-600/20 blur-[120px]" />
        <div className="absolute mt-[-40px] h-[320px] w-[420px] translate-x-40 rounded-full bg-violet-600/10 blur-[100px]" />
      </div>

      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center">
        <LogoMark className="h-14 w-14" />
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          Meta<span className="text-blue-500">Arena</span>Stats
        </h1>
        <p className="mt-4 max-w-xl text-balance text-zinc-400">
          Free stats, tier lists and leaderboards for League of Legends Arena — the 3v3 &quot;Three
          by Six&quot; mode.
        </p>

        <div className="mt-6 flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-1.5 text-sm text-zinc-500">
          <span>
            <span className="font-mono font-medium text-zinc-200">{totalMatches}</span> matches
          </span>
          <span className="text-zinc-700">•</span>
          <span>
            <span className="font-mono font-medium text-zinc-200">{totalChampions}</span>{" "}
            champions
          </span>
          <span className="text-zinc-700">•</span>
          <span>
            <span className="font-mono font-medium text-zinc-200">{totalPlayers}</span> players
            tracked
          </span>
        </div>

        <div className="mt-10 w-full">
          <HomeSearch />
        </div>
      </div>
    </div>
  );
}
