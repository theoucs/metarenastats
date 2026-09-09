"use client";

import type { ReactNode } from "react";

/** Instant, styled hover bubble (not the native title="" tooltip). */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 opacity-0 shadow-lg transition-opacity duration-100 group-hover/tip:opacity-100">
        {content}
      </span>
    </span>
  );
}
