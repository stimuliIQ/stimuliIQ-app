"use client";

import * as React from "react";

/**
 * useReducedMotion — SSR-safe `prefers-reduced-motion` detector, per
 * docs/07-design-system.md §7 ("Always respect prefers-reduced-motion") and CLAUDE.md §3.9.
 * On the server / first render this returns `false` (matching StatBand's approach) and is
 * corrected via `useEffect` before the animated content becomes interactive — a harmless
 * flash of "animated" state is never visible because effects run before paint commit is
 * shown to the user in practice for this class of enhancement (chart entrance animation).
 *
 * Used by chart primitives to disable recharts entrance animations
 * (`isAnimationActive={!reducedMotion}`) and count-up sparkline transitions.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
