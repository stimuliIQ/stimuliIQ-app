"use client";

import * as React from "react";

import { cn } from "../lib/cn";

/**
 * StatBand / CountUp — animated statistics strip for the homepage.
 * Per docs/01-prd-website.md §7.2 ("Stats band — animated counters") and
 * docs/07-design-system.md §7/§11 ("prefers-reduced-motion always respected").
 *
 * Animation (minimal, staggered — triggers once on scroll into view):
 *   1. Each stat fade-rises in, cascading left → right (120 ms stagger).
 *   2. A hairline accent draws outward beneath each number.
 *   3. Counters ease-out from 0 to their target, same cascade.
 * SSR/no-JS renders everything fully visible; the pre-reveal (hidden) state
 * is applied only after hydration, so SEO and no-JS visitors see the values.
 *
 * a11y:
 * - Each stat is a <dl>/<dt>/<dd> pair — screen readers announce label + value.
 * - The count-up animation is a CSS/JS visual enhancement; the final value is
 *   always in the DOM so the data is accessible without animation.
 * - `prefers-reduced-motion`: animation is disabled (value shown statically).
 *   Detected via the `useReducedMotion` hook (matchMedia, SSR-safe via useEffect).
 *
 * SSR-safety: `useEffect` guards all window/matchMedia access. On first server render,
 * numbers start at their target value (no animation) — correct and not a layout shift.
 *
 * Usage:
 *   <StatBand
 *     stats={[
 *       { value: 15000, label: "Students trained", suffix: "+" },
 *       { value: 30, label: "Programs", suffix: "+" },
 *       { value: 94, label: "Placement rate", suffix: "%" },
 *       { value: 50, label: "Cities", suffix: "+" },
 *     ]}
 *   />
 */

export interface StatItem {
  value: number;
  label: string;
  /** Text appended after the number, e.g. "+" or "%". */
  suffix?: string;
  /** Text prepended before the number, e.g. "₹". */
  prefix?: string;
}

export interface StatBandProps {
  stats: StatItem[];
  className?: string;
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// useReducedMotion — SSR-safe
// ---------------------------------------------------------------------------

function useReducedMotion(): boolean {
  // SSR: return false (animation would run) — corrected by effect before paint.
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}

// ---------------------------------------------------------------------------
// useCountUp — animates 0 → target over `duration` ms (after `delayMs`)
// ---------------------------------------------------------------------------

const COUNT_DURATION_MS = 1800;
const FPS = 60;
/** Per-stat stagger — entrance, accent line, and counter all cascade by this. */
const STAGGER_MS = 120;

function useCountUp(
  target: number,
  active: boolean,
  reducedMotion: boolean,
  delayMs = 0,
): number {
  const [count, setCount] = React.useState(reducedMotion ? target : 0);

  React.useEffect(() => {
    if (reducedMotion || !active) {
      setCount(target);
      return;
    }

    setCount(0);
    const steps = Math.ceil(COUNT_DURATION_MS / (1000 / FPS));
    let step = 0;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    // Stagger: each stat starts counting slightly after the previous one,
    // so the band reads as a cascade instead of four counters in lockstep.
    const timeoutId = setTimeout(() => {
      intervalId = setInterval(() => {
        step += 1;
        const progress = Math.min(step / steps, 1);
        // ease-out cubic — fast start, gentle settle on the final value
        const eased = 1 - Math.pow(1 - progress, 3);
        setCount(Math.round(eased * target));
        if (step >= steps && intervalId) clearInterval(intervalId);
      }, 1000 / FPS);
    }, delayMs);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [target, active, reducedMotion, delayMs]);

  return count;
}

// ---------------------------------------------------------------------------
// SingleStat
// ---------------------------------------------------------------------------

interface SingleStatProps {
  stat: StatItem;
  index: number;
  active: boolean;
  /** True once the component mounted client-side (gates the entrance state). */
  mounted: boolean;
  reducedMotion: boolean;
}

function SingleStat({
  stat,
  index,
  active,
  mounted,
  reducedMotion,
}: SingleStatProps): React.JSX.Element {
  const delayMs = index * STAGGER_MS;
  const count = useCountUp(stat.value, active, reducedMotion, delayMs);

  // Entrance choreography: fade-rise + hairline accent drawing in, staggered
  // per stat. SSR/no-JS renders fully visible (SEO + resilience); only after
  // hydration — and only until the band scrolls into view — is the pre-reveal
  // state applied. Reduced motion: no entrance, values render statically.
  const animate = mounted && !reducedMotion;
  const revealed = !animate || active;
  const delayStyle = { transitionDelay: `${delayMs}ms` };

  return (
    <div className="flex flex-col items-center px-6 py-4 text-center">
      <dd
        aria-live={active && !reducedMotion ? "polite" : undefined}
        aria-atomic="true"
        style={delayStyle}
        className={cn(
          "text-4xl font-bold tabular-nums text-fg font-display md:text-5xl",
          "transition-all duration-700 ease-out",
          revealed ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        )}
      >
        {stat.prefix ?? ""}
        {count.toLocaleString("en-IN")}
        {stat.suffix ?? ""}
      </dd>

      {/* Hairline accent — draws outward under the number */}
      <span
        aria-hidden="true"
        style={delayStyle}
        className={cn(
          "my-2.5 h-px w-10 bg-fg transition-transform duration-700 ease-out",
          revealed ? "scale-x-100" : "scale-x-0",
        )}
      />

      <dt
        style={delayStyle}
        className={cn(
          "text-sm font-medium text-fg-muted",
          "transition-opacity duration-700 ease-out",
          revealed ? "opacity-100" : "opacity-0",
        )}
      >
        {stat.label}
      </dt>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatBand (public component)
// ---------------------------------------------------------------------------

export function StatBand({
  stats,
  className,
  "data-testid": testId,
}: StatBandProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const sectionRef = React.useRef<HTMLElement>(null);
  const [visible, setVisible] = React.useState(false);
  // Mounted flag: the entrance's hidden state must never apply to server HTML
  // (SEO / no-JS resilience) — only after hydration, pre-reveal.
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Trigger count-up + entrance when the band enters the viewport
  React.useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      data-testid={testId ?? "stat-band"}
      aria-label="Key statistics"
      className={cn("w-full border-y border-border bg-surface py-8", className)}
    >
      <dl
        className={cn(
          "mx-auto grid max-w-screen-xl grid-cols-2 divide-x divide-border md:grid-cols-4",
        )}
      >
        {stats.map((stat, index) => (
          <SingleStat
            key={stat.label}
            stat={stat}
            index={index}
            active={visible}
            mounted={mounted}
            reducedMotion={reducedMotion}
          />
        ))}
      </dl>
    </section>
  );
}

StatBand.displayName = "StatBand";
