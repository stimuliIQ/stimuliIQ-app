"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn";

/**
 * ProgressRing — circular SVG progress indicator for course/module completion.
 * Per docs/07-design-system.md §5 ("ProgressRing / ProgressBar — course completion,
 * dashboards") and docs/02-prd-lms.md §7.1 ("progress ring per course").
 *
 * a11y: role="progressbar", aria-valuenow/min/max, aria-label, WCAG AA contrast via
 * tokens, no color-only meaning (visible percentage label inside the ring).
 *
 * Usage:
 *   <ProgressRing value={72} label="Python Basics" />
 *   <ProgressRing value={100} size="lg" tone="success" showLabel={false} aria-label="Completed" />
 */

export type ProgressTone = "brand" | "success" | "warning" | "danger";

const ringToneStroke: Record<ProgressTone, string> = {
  brand: "stroke-brand-500",
  success: "stroke-success",
  warning: "stroke-warning",
  danger: "stroke-danger",
};

const ringToneText: Record<ProgressTone, string> = {
  brand: "text-brand-500",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export interface ProgressRingProps
  extends Omit<React.SVGAttributes<SVGSVGElement>, "role" | "aria-valuenow"> {
  /** Completion percentage 0–100. */
  value: number;
  /**
   * Accessible name for the progressbar — required when `showLabel` is false or the ring
   * is used without surrounding context. Passed as aria-label on the SVG.
   */
  label?: string;
  /** Show the percentage text centred inside the ring (default: true). */
  showLabel?: boolean;
  /** Visual size: sm=40px, md=56px (default), lg=80px. */
  size?: "sm" | "md" | "lg";
  tone?: ProgressTone;
  /** Test hook; defaults to "progress-ring" when omitted. */
  "data-testid"?: string;
}

const sizeMap = {
  sm: { px: 40, stroke: 4, fontSize: "text-xs" },
  md: { px: 56, stroke: 5, fontSize: "text-sm" },
  lg: { px: 80, stroke: 6, fontSize: "text-base" },
} as const;

export const ProgressRing = React.forwardRef<SVGSVGElement, ProgressRingProps>(
  (
    {
      value,
      label,
      showLabel = true,
      size = "md",
      tone = "brand",
      className,
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    const clamped = Math.min(100, Math.max(0, value));
    const { px, stroke, fontSize } = sizeMap[size];
    const radius = (px - stroke * 2) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (clamped / 100) * circumference;
    const centre = px / 2;

    return (
      <svg
        ref={ref}
        data-testid={testId ?? "progress-ring"}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? `${clamped}% complete`}
        width={px}
        height={px}
        viewBox={`0 0 ${px} ${px}`}
        className={cn("shrink-0", className)}
        {...props}
      >
        {/* Track (background circle) */}
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          strokeWidth={stroke}
          className="stroke-border fill-none"
          aria-hidden="true"
        />
        {/* Progress arc */}
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${centre} ${centre})`}
          className={cn("fill-none transition-[stroke-dashoffset] duration-slow ease-out", ringToneStroke[tone])}
          aria-hidden="true"
        />
        {/* Percentage label */}
        {showLabel ? (
          <text
            x={centre}
            y={centre}
            dominantBaseline="middle"
            textAnchor="middle"
            aria-hidden="true"
            className={cn("font-semibold tabular-nums", fontSize, ringToneText[tone])}
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {clamped}%
          </text>
        ) : null}
      </svg>
    );
  },
);
ProgressRing.displayName = "ProgressRing";

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

/**
 * ProgressBar — horizontal linear progress indicator, per docs/07-design-system.md §5.
 * Used inside CourseCard, ContinueLearning, and any narrow context where a ring won't fit.
 *
 * a11y: role="progressbar", aria-valuenow/min/max, aria-label; never color-only
 * (percentage text is rendered unless `showLabel={false}`).
 *
 * Usage:
 *   <ProgressBar value={45} label="Module 2 completion" />
 *   <ProgressBar value={100} tone="success" size="sm" showLabel={false} />
 */

const progressBarVariants = cva("relative w-full overflow-hidden rounded-full bg-border", {
  variants: {
    size: {
      sm: "h-1.5",
      md: "h-2",
      lg: "h-3",
    },
  },
  defaultVariants: { size: "md" },
});

const barToneFill: Record<ProgressTone, string> = {
  brand: "bg-brand-500",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export interface ProgressBarProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "role" | "aria-valuenow">,
    VariantProps<typeof progressBarVariants> {
  /** Completion percentage 0–100. */
  value: number;
  /**
   * Accessible name — required when there is no visible label nearby.
   * Passed as aria-label on the progressbar element.
   */
  label?: string;
  /** Show a "45%" percentage text to the right of the bar (default: false). */
  showLabel?: boolean;
  tone?: ProgressTone;
  /** Test hook; defaults to "progress-bar" when omitted. */
  "data-testid"?: string;
}

export const ProgressBar = React.forwardRef<HTMLDivElement, ProgressBarProps>(
  (
    {
      value,
      label,
      showLabel = false,
      size,
      tone = "brand",
      className,
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    const clamped = Math.min(100, Math.max(0, value));

    return (
      <div
        className={cn("flex items-center gap-2", showLabel && "flex-row")}
      >
        <div
          ref={ref}
          data-testid={testId ?? "progress-bar"}
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label ?? `${clamped}% complete`}
          className={cn(progressBarVariants({ size }), "flex-1", className)}
          {...props}
        >
          <div
            aria-hidden="true"
            className={cn(
              "h-full rounded-full transition-[width] duration-slow ease-out",
              barToneFill[tone],
            )}
            style={{ width: `${clamped}%` }}
          />
        </div>
        {showLabel ? (
          <span aria-hidden="true" className="shrink-0 text-xs font-medium text-fg-muted tabular-nums">
            {clamped}%
          </span>
        ) : null}
      </div>
    );
  },
);
ProgressBar.displayName = "ProgressBar";
