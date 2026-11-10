"use client";

import { useSyncExternalStore } from "react";

const NARROW = "(max-width: 640px)";

// Phone widths, for charts that shorten their labels to keep the plot wide. The server renders the wide layout,
// and the chart switches after hydration.
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(NARROW);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}
