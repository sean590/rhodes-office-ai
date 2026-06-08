"use client";

import { useSyncExternalStore } from "react";

/**
 * SSR-safe media-query hook. Returns whether the query currently matches.
 * Used by the app shell for the ≤1024px sidebar-rail tier.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
