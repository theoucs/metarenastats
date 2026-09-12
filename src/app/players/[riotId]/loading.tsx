/**
 * The player page waits on a live Riot API call, so this is on screen for
 * seconds, not milliseconds. The previous version used `bg-raised` (#111318)
 * on `bg-base` (#0A0B0F) — 1.06:1 of contrast, i.e. a blank page. It now uses
 * --bg-overlay and a travelling highlight, and mirrors the real layout (one
 * emphasised pill + three normal ones) so nothing jumps when data lands.
 */
const BLOCK =
  "rounded-xl bg-[color:var(--bg-overlay)] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)] bg-[length:200%_100%] motion-safe:animate-[shimmer_1.4s_linear_infinite]";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center gap-4">
        <div className={`h-16 w-16 ${BLOCK}`} />
        <div className="space-y-2">
          <div className={`h-6 w-48 ${BLOCK}`} />
          <div className={`h-4 w-32 ${BLOCK}`} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 [&>*:first-child]:col-span-2 sm:grid-cols-4 sm:[&>*:first-child]:col-span-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`h-[86px] ${BLOCK}`} />
        ))}
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_minmax(0,380px)]">
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`h-24 ${BLOCK}`} />
          ))}
        </div>
        <div className={`h-64 ${BLOCK}`} />
      </div>
    </div>
  );
}
