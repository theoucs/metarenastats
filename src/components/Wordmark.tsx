// "MetArenaStats" = Met(a) + Arena + Stats — Meta's trailing "a" and Arena's
// leading "A" collapse into one shared letter. That shared "A" is rendered
// larger than the rest of the word so it visibly belongs to both halves.
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline whitespace-nowrap ${className}`}>
      Met
      <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-[1.2em] font-bold text-transparent">
        A
      </span>
      <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
        rena
      </span>
      Stats
    </span>
  );
}
