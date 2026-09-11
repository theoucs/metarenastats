"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type HighlightRect = { left: number; top: number; width: number; height: number };

/**
 * Tracks the active option's box for the sliding highlight behind a pill group
 * (the sort control, the tier tabs).
 *
 * Measures all four sides rather than just left/width. These groups wrap on
 * narrow screens, and a highlight positioned with `inset-y-1` stretched to
 * cover *every* wrapped row — 54px tall behind a 27px pill on a phone.
 *
 * The ResizeObserver matters for the same reason: how many rows the group
 * wraps into changes with the container width, so a highlight measured once at
 * mount is wrong the moment the layout reflows.
 */
export function useSlidingHighlight<K>(activeKey: K, revision?: unknown) {
  const containerRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Map<K, HTMLElement>>(new Map());
  const [rect, setRect] = useState<HighlightRect | null>(null);

  const measure = useCallback(() => {
    const el = refs.current.get(activeKey);
    setRect(
      el
        ? { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
        : null
    );
  }, [activeKey]);

  useLayoutEffect(() => {
    measure();
  }, [measure, revision]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const register = useCallback(
    (key: K) => (el: HTMLElement | null) => {
      if (el) refs.current.set(key, el);
      else refs.current.delete(key);
    },
    []
  );

  return { containerRef, register, rect };
}

/** The pill itself — absolutely positioned inside a `relative` pill group. */
export function SlidingHighlight({ rect }: { rect: HighlightRect | null }) {
  if (!rect) return null;
  return (
    <div
      aria-hidden="true"
      className="absolute z-0 rounded-md bg-overlay shadow-[var(--elev-2)] transition-[left,top,width,height] duration-[250ms] ease-out motion-reduce:transition-none"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    />
  );
}
