// Fill matches --prism-brand in globals.css — sampled from real prismatic
// augment icon glyphs (Eureka, Cruelty, King Me), not the card frame (see
// globals.css comment). A plain CSS background (not an SVG fill) so it can
// share the exact same motion-safe:animate-prism-shimmer as Wordmark.tsx —
// icon.svg/favicon.ico keep a static (unanimated) copy of the same gradient,
// since a .ico can't animate; keep all three in sync by eye if this changes.
// Dot size/position match the original rx=9 / r=3.2 SVG on a 32-unit box,
// expressed as % so they scale with whatever size `className` sets.
// The mark is a rounded square with three pips — a die face. Hovering the nav
// brand rolls it one full turn (360°, so the pips land exactly where they
// started and the resting shape always matches icon.svg/favicon.ico) with a
// slight overshoot and a 6% scale-up, as if it tumbled towards the reader.
// A transition rather than a keyframe animation on purpose: leaving mid-roll
// unwinds smoothly instead of snapping back. Requires a `group` ancestor —
// Nav.tsx is the only call site.
const ROLL =
  "transition-transform duration-[720ms] [transition-timing-function:cubic-bezier(.22,1.15,.36,1)] " +
  "motion-safe:group-hover:rotate-[360deg] motion-safe:group-hover:scale-[1.06] " +
  "motion-safe:group-focus-visible:rotate-[360deg] motion-safe:group-focus-visible:scale-[1.06]";

export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <span
      className={`relative inline-block shrink-0 overflow-hidden rounded-[28.125%] bg-[length:260%_260%] motion-safe:animate-prism-shimmer ${ROLL} ${className}`}
      style={{ backgroundImage: "var(--prism-brand)" }}
      aria-hidden
    >
      <span className="absolute left-1/2 top-[32.8%] h-[20%] w-[20%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      <span className="absolute left-[29.7%] top-[65.6%] h-[20%] w-[20%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      <span className="absolute left-[70.3%] top-[65.6%] h-[20%] w-[20%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
    </span>
  );
}
