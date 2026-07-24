"use client";

/**
 * CountUp — animates a numeric stat from 0 to its value when scrolled into view.
 *
 * Progressive-enhancement contract (SEO + a11y first):
 *   - SSR renders the FINAL formatted value, so search engines, no-JS visitors, and
 *     anyone with `prefers-reduced-motion: reduce` always see the real number.
 *   - The 0 → target animation only runs on the client, once, when the element enters
 *     the viewport, and only when reduced-motion is NOT requested.
 *   - Initial state === the SSR text (no hydration mismatch); the reset-to-0 happens in a
 *     layout effect (before paint), so there is no flash of the final number.
 *
 * Only the number itself is a client island — the surrounding StatsBento stays a Server
 * Component.
 */

import * as React from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/** Split "15,000+" into { target: 15000, suffix: "+" }. Non-numeric → target null. */
function parseValue(value: string): { target: number | null; suffix: string } {
  const match = value.match(/^([\d,]+)(.*)$/);
  if (!match) return { target: null, suffix: "" };
  const target = Number.parseInt(match[1]!.replace(/,/g, ""), 10);
  return { target: Number.isNaN(target) ? null : target, suffix: match[2] ?? "" };
}

function format(n: number, suffix: string): string {
  return `${Math.round(n).toLocaleString("en-IN")}${suffix}`;
}

/** easeOutCubic — fast start, gentle settle. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const DURATION_MS = 1400;

export function CountUp({
  value,
  className,
  durationMs = DURATION_MS,
}: {
  /** Pre-formatted figure, e.g. "15,000+". */
  value: string;
  className?: string;
  durationMs?: number;
}): React.JSX.Element {
  const { target, suffix } = parseValue(value);
  // Initial state matches SSR (the final value) → no hydration mismatch.
  const [display, setDisplay] = React.useState(value);
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const hasAnimated = React.useRef(false);

  useIsomorphicLayoutEffect(() => {
    // Nothing to animate for non-numeric values.
    if (target === null) return;

    const prefersReduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    // Reset to 0 before the browser paints (no flash of the final number).
    setDisplay(format(0, suffix));

    let rafId = 0;
    let startTs = 0;

    const step = (ts: number) => {
      if (startTs === 0) startTs = ts;
      const progress = Math.min((ts - startTs) / durationMs, 1);
      setDisplay(format(target * easeOutCubic(progress), suffix));
      if (progress < 1) {
        rafId = window.requestAnimationFrame(step);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !hasAnimated.current) {
            hasAnimated.current = true;
            rafId = window.requestAnimationFrame(step);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
    };
    // durationMs/suffix/target are derived from the stable `value` prop.
  }, [target, suffix, durationMs]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
