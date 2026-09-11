"use client";

import { useRef, type ReactNode } from "react";

/** Keep this much clear space between the bubble and the viewport edge. */
const VIEWPORT_MARGIN = 8;

/** Instant, styled hover bubble (not the native title="" tooltip). */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const tipRef = useRef<HTMLSpanElement>(null);

  // Centering on the trigger (translateX(-50%)) hangs the bubble half-off-screen
  // whenever the trigger sits within half a bubble-width of a viewport edge —
  // which is every rightmost item icon in a build row on a phone. Nudge it back
  // in on hover/focus, the only times it's visible.
  //
  // Written straight to the DOM rather than through state: this fires on every
  // pointerenter across a row of icons, and none of it should cost a render.
  function clampIntoViewport() {
    const el = tipRef.current;
    if (!el) return;
    el.style.setProperty("--tip-shift", "0px");
    const rect = el.getBoundingClientRect();
    let shift = 0;
    if (rect.left < VIEWPORT_MARGIN) {
      shift = VIEWPORT_MARGIN - rect.left;
    } else if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
      shift = window.innerWidth - VIEWPORT_MARGIN - rect.right;
    }
    el.style.setProperty("--tip-shift", `${shift}px`);
  }

  return (
    <span
      className="group/tip relative inline-flex"
      onPointerEnter={clampIntoViewport}
      onFocus={clampIntoViewport}
    >
      {children}
      <span
        ref={tipRef}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-max max-w-[calc(100vw-2rem)] rounded-md border border-default bg-inset px-2.5 py-1.5 text-micro text-primary opacity-0 shadow-[var(--elev-3)] transition-opacity duration-100 group-hover/tip:opacity-100"
        style={{ transform: "translateX(calc(-50% + var(--tip-shift, 0px)))" }}
      >
        {content}
      </span>
    </span>
  );
}
