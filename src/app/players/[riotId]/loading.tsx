export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 animate-pulse rounded-xl bg-zinc-900" />
        <div className="space-y-2">
          <div className="h-6 w-48 animate-pulse rounded bg-zinc-900" />
          <div className="h-4 w-32 animate-pulse rounded bg-zinc-900" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-900" />
        ))}
      </div>
      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_minmax(0,380px)]">
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-900/60" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg bg-zinc-900/60" />
      </div>
    </div>
  );
}
