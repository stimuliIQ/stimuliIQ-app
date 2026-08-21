import * as React from "react";
import { Flame, Star } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * PointsBadge — displays the user's current XP/points total.
 * StreakFlame — displays the current day-streak with a flame icon.
 * Per docs/02-prd-lms.md §7.12, docs/07 §7/§11.
 *
 * Both components:
 * - Are `prefers-reduced-motion` aware: animations are disabled when the user's OS
 *   setting requests reduced motion. The flame pulsing and count-up are CSS animation
 *   classes that the `motion-safe:` Tailwind variant gates.
 * - Never use color alone — a text label accompanies the number.
 * - Expose `data-testid`.
 *
 * PointsBadge usage:
 *   <PointsBadge points={4250} label="XP" />
 *
 * StreakFlame usage:
 *   <StreakFlame days={14} />
 *   <StreakFlame days={0} />   // "No active streak"
 */

// ---------------------------------------------------------------------------
// PointsBadge
// ---------------------------------------------------------------------------

export interface PointsBadgeProps {
  /** Total points/XP to display. */
  points: number;
  /** Unit label shown next to the number. Defaults to "XP". */
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Test hook; defaults to "points-badge". */
  "data-testid"?: string;
}

const pointsSizeMap = {
  sm: { wrap: "gap-1 px-2 py-1", icon: "size-3.5", value: "text-sm font-semibold", unit: "text-xs" },
  md: { wrap: "gap-1.5 px-3 py-1.5", icon: "size-4", value: "text-base font-semibold", unit: "text-sm" },
  lg: { wrap: "gap-2 px-4 py-2", icon: "size-5", value: "text-xl font-bold", unit: "text-base" },
} as const;

export function PointsBadge({
  points,
  label = "XP",
  size = "md",
  className,
  "data-testid": testId,
}: PointsBadgeProps): React.JSX.Element {
  const { wrap, icon, value, unit } = pointsSizeMap[size];

  return (
    <div
      data-testid={testId ?? "points-badge"}
      aria-label={`${points.toLocaleString("en-IN")} ${label}`}
      className={cn(
        "inline-flex items-center rounded-full border border-brand-200 bg-brand-50",
        "text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300",
        wrap,
        className,
      )}
    >
      <Star aria-hidden="true" className={cn(icon, "shrink-0 fill-current opacity-80")} />
      <span aria-hidden="true" className={cn("tabular-nums", value)}>
        {points.toLocaleString("en-IN")}
      </span>
      <span aria-hidden="true" className={cn("font-medium opacity-70", unit)}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreakFlame
// ---------------------------------------------------------------------------

export interface StreakFlameProps {
  /** Current streak in days. 0 means no active streak. */
  days: number;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Test hook; defaults to "streak-flame". */
  "data-testid"?: string;
}

const streakSizeMap = {
  sm: { wrap: "gap-1 px-2 py-1", icon: "size-3.5", value: "text-sm font-semibold", unit: "text-xs" },
  md: { wrap: "gap-1.5 px-3 py-1.5", icon: "size-4", value: "text-base font-semibold", unit: "text-sm" },
  lg: { wrap: "gap-2 px-4 py-2", icon: "size-5", value: "text-xl font-bold", unit: "text-base" },
} as const;

export function StreakFlame({
  days,
  size = "md",
  className,
  "data-testid": testId,
}: StreakFlameProps): React.JSX.Element {
  const { wrap, icon, value, unit } = streakSizeMap[size];
  const isActive = days > 0;

  return (
    <div
      data-testid={testId ?? "streak-flame"}
      aria-label={
        isActive
          ? `${days}-day streak`
          : "No active streak. Start learning today to begin a streak"
      }
      className={cn(
        "inline-flex items-center rounded-full border",
        isActive
          ? "border-warning/40 bg-warning/10 text-warning dark:border-warning/30 dark:bg-warning/10"
          : "border-border bg-surface text-fg-subtle",
        wrap,
        className,
      )}
    >
      {/*
       * Flame icon: motion-safe:animate-pulse gates the animation behind
       * prefers-reduced-motion. When reduced-motion is requested by the OS,
       * `motion-safe:` variants are suppressed and the icon renders statically.
       */}
      <Flame
        aria-hidden="true"
        className={cn(
          icon,
          "shrink-0",
          isActive && "fill-current opacity-80 motion-safe:animate-pulse",
        )}
        style={isActive ? { animationDuration: "1.8s" } : undefined}
      />
      <span aria-hidden="true" className={cn("tabular-nums", value)}>
        {days}
      </span>
      <span aria-hidden="true" className={cn("font-medium opacity-70", unit)}>
        {days === 1 ? "day" : "days"}
      </span>
    </div>
  );
}
