import * as React from "react";

import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

/**
 * ChartFrame — shared accessible shell for every `@repo/ui` chart primitive (LineChart,
 * AreaChart, BarChart, FunnelChart, DonutChart/PieChart). Per the Phase-7 chart-primitives
 * task and docs/07-design-system.md §11 (a11y checklist), every chart must:
 *
 *  1. Have an accessible name — `role="img"` + `aria-label` on the element wrapping the
 *     recharts `ResponsiveContainer` (a chart's pixels alone are not accessible).
 *  2. Expose a **visually-hidden data-table fallback** — a real `<table>` with the same
 *     values, wrapped in `<figure>`/`<figcaption>` so assistive tech can read the underlying
 *     data (charts are supplementary — the table is the accessible source of truth).
 *  3. Have first-class loading / error / empty states (CLAUDE.md §4).
 *
 * Callers build the `<thead>`/`<tbody>` markup for their chart's shape and pass it via the
 * `table` prop; ChartFrame wraps it in a `sr-only` `<table>` with a `<caption>`. A visible
 * `legend` slot (see `ChartLegend`) pairs each series/category color with its label — colors
 * are never the sole channel of meaning (docs/07 §2).
 *
 * Not exported as a "primitive" in its own right in the phase-7 task list, but exported from
 * `@repo/ui` because it's the shared seam other chart-like components can reuse.
 */
export interface ChartFrameProps {
  /** Visible chart title, also folded into the chart's accessible name. */
  title: string;
  /** Optional visible subtitle/context, also folded into the accessible name. */
  description?: string;
  /** Pixel height of the chart plotting area (ResponsiveContainer height). Default 280. */
  height?: number;
  loading?: boolean;
  error?: string;
  /** True when there is no data to plot — renders the EmptyState instead of the chart. */
  empty?: boolean;
  emptyMessage?: string;
  className?: string;
  /** Test hook; defaults to "chart-frame" when omitted. */
  "data-testid"?: string;
  /** Visible legend rendered below the chart (see `ChartLegend`). */
  legend?: React.ReactNode;
  /** `<thead>…</thead><tbody>…</tbody>` markup for the sr-only data-table fallback. */
  table: React.ReactNode;
  /** The recharts `<ResponsiveContainer>` (or other chart markup) to render. */
  children: React.ReactNode;
}

export function ChartFrame({
  title,
  description,
  height = 280,
  loading = false,
  error,
  empty = false,
  emptyMessage = "No data for this range yet.",
  className,
  "data-testid": testId,
  legend,
  table,
  children,
}: ChartFrameProps): React.JSX.Element {
  const resolvedTestId = testId ?? "chart-frame";
  const accessibleName = description ? `${title} — ${description}` : title;

  if (loading) {
    return (
      <div
        data-testid={resolvedTestId}
        aria-busy="true"
        aria-label={`Loading ${title}`}
        className={cn("rounded-lg border border-border bg-card p-4", className)}
      >
        <Skeleton shape="line" className="mb-4 h-5 w-1/3" />
        <Skeleton shape="block" style={{ height }} className="w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid={resolvedTestId}
        role="alert"
        className={cn(
          "rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger",
          className,
        )}
      >
        {error}
      </div>
    );
  }

  if (empty) {
    return (
      <div
        data-testid={resolvedTestId}
        className={cn("rounded-lg border border-border bg-card", className)}
      >
        <p className="px-4 pt-4 text-sm font-semibold text-fg">{title}</p>
        <EmptyState title={emptyMessage} />
      </div>
    );
  }

  return (
    <figure
      data-testid={resolvedTestId}
      className={cn("rounded-lg border border-border bg-card p-4", className)}
    >
      <figcaption className="mb-3 flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-fg">{title}</span>
        {description ? <span className="text-xs text-fg-muted">{description}</span> : null}
      </figcaption>

      {/* The chart is presentational; role="img" + aria-label give it an accessible name.
          The real data is exposed to assistive tech via the sr-only <table> below. */}
      <div role="img" aria-label={accessibleName} style={{ height }}>
        {children}
      </div>

      {legend ? <div className="mt-3">{legend}</div> : null}

      <table className="sr-only">
        <caption>{accessibleName}</caption>
        {table}
      </table>
    </figure>
  );
}
ChartFrame.displayName = "ChartFrame";

// ---------------------------------------------------------------------------
// ChartLegend — visible color↔label pairing (never color-only, docs/07 §2)
// ---------------------------------------------------------------------------

export interface ChartLegendItem {
  key: string;
  label: string;
  /** Resolved CSS color string, e.g. `rgb(var(--chart-1))`. */
  color: string;
  /** Optional formatted value/percentage shown after the label. */
  value?: string;
}

export interface ChartLegendProps {
  items: ChartLegendItem[];
  className?: string;
  /** Test hook; defaults to "chart-legend" when omitted. */
  "data-testid"?: string;
}

/**
 * ChartLegend — swatch + label (+ optional value) per series/category. The swatch is
 * `aria-hidden` (decorative); the label text is what makes each series distinguishable to
 * screen-reader users and to users who can't distinguish the hues (docs/07 §2).
 */
export function ChartLegend({
  items,
  className,
  "data-testid": testId,
}: ChartLegendProps): React.JSX.Element {
  return (
    <ul
      data-testid={testId ?? "chart-legend"}
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}
    >
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-xs text-fg-muted">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          <span className="font-medium text-fg">{item.label}</span>
          {item.value ? <span>{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}
ChartLegend.displayName = "ChartLegend";
