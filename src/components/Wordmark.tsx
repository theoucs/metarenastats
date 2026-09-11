// "MetArenaStats" = Met(a) + Arena + Stats — Meta's trailing "a" and Arena's
// leading "A" collapse into one shared letter. That shared "A" is rendered
// larger than the rest of the word so it visibly belongs to both halves.
// "Arena" carries the --prism-brand gradient (see globals.css) — same
// identity, and same motion-safe:animate-prism-shimmer, as the logo mark.
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline whitespace-nowrap font-display ${className}`}>
      Met
      <span
        className="bg-[length:260%_260%] bg-clip-text text-[1.2em] font-bold text-transparent motion-safe:animate-prism-shimmer"
        style={{ backgroundImage: "var(--prism-brand)" }}
      >
        A
      </span>
      <span
        className="bg-[length:260%_260%] bg-clip-text text-transparent motion-safe:animate-prism-shimmer"
        style={{ backgroundImage: "var(--prism-brand)" }}
      >
        rena
      </span>
      Stats
    </span>
  );
}
