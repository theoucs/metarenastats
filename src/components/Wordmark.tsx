// "MetaRenaStats" = Meta + (A)rena + Stats — the two shared "a"s collapse into
// one. The elided "A" is shown as a faint ghost letter tucked behind the R,
// so the wordplay reads as deliberate rather than a typo.
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline whitespace-nowrap ${className}`}>
      Meta
      <span className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute -left-[0.24em] bottom-[0.02em] select-none text-[0.55em] font-normal leading-none text-blue-400/35"
        >
          A
        </span>
        <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
          Rena
        </span>
      </span>
      Stats
    </span>
  );
}
