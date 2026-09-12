"use client";

import { useState, type ReactNode } from "react";

/**
 * Collapses long methodology/caveat notes under a page header behind a toggle
 * so casual visitors aren't hit with a wall of text — only shown if they ask.
 */
export function ShowMoreNote({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-small font-medium text-accent hover:underline"
      >
        {open ? "Show less" : "Show more"}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
