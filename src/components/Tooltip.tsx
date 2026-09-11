"use client";

import type { ReactNode } from "react";

/** Instant, styled hover bubble (not the native title="" tooltip). */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border border-default bg-inset px-2.5 py-1.5 text-micro text-primary opacity-0 shadow-[var(--elev-3)] transition-opacity duration-100 group-hover/tip:opacity-100">
        {content}
      </span>
    </span>
  );
}
