"use client";

import { useSyncExternalStore } from "react";

// The md breakpoint: from here up the catalog is a table, below it a stacked list.
const WIDE = "(min-width: 48rem)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True when the window is wide enough for the table. Results are rendered once, in the
 * layout that fits, so an open kit exists once in the page and ids stay unique.
 */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}
