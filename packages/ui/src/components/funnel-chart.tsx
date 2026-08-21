"use client";

import * as React from "react";

import { getChartColor } from "../lib/chart-colors";
import { ChartFrame } from "./chart-frame";

/**
 * FunnelChart — ordered stage funnel with conversion percentages, built for the CRM
 * lead-funnel dashboard (docs/03-prd-crm.md §7.14, docs/plans/phase-7.md Wave 1 #5).
 *
 * Rendered as horizontal stage bars (label · proportional bar · count + %), not an
 * SVG trapezoid: bar *length* already encodes magnitude, labels are real HTML text so
 * they never clip, zero-count stages render as a visible empty track instead of a
 * degenerate shape, and the layout scales to any container width. One hue for every
 * stage — magnitude is a sequential job, so per-stage categorical colors would imply
 * identity that isn't there (docs/07-design-system.md §2).
 *
 * Conversion is computed here (pure display math on already-aggregated counts — not money,
 * so ordinary arithmetic is fine per CLAUDE.md §3.6 which only restricts *money*): each
 * stage shows count + "% of first stage" as visible text (never color-only), with
 * "% of previous stage" in the row tooltip and the sr-only data table.
 *
 * a11y: `ChartFrame` shell (accessible name, sr-only table with both percentages).
 *
 * Usage:
 *   <FunnelChart
 *     title="Lead funnel"
 *     description="Last 30 days"
 *     stages={[
 *       { key: "leads", label: "Leads", value: 1200 },
 *       { key: "qualified", label: "Qualified", value: 640 },
 *       { key: "enrolled", label: "Enrolled", value: 210 },
 *     ]}
 *   />
 */

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export interface FunnelChartProps {
  title: string;
  description?: string;
  stages: FunnelStage[];
  /** Plot height in px; defaults to a per-stage row height so the card hugs its content. */
  height?: number;
  valueFormatter?: (value: number) => string;
  loading?: boolean;
  error?: string;
  emptyMessage?: string;
  className?: string;
  /** Test hook; defaults to "funnel-chart" when omitted. */
  "data-testid"?: string;
}

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "-";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

const ROW_HEIGHT = 32;

export function FunnelChart({
  title,
  description,
  stages,
  height,
  valueFormatter = (v) => String(v),
  loading = false,
  error,
  emptyMessage,
  className,
  "data-testid": testId,
}: FunnelChartProps): React.JSX.Element {
  const firstValue = stages[0]?.value ?? 0;
  const firstLabel = stages[0]?.label ?? "first stage";

  const table = (
    <>
      <thead>
        <tr>
          <th scope="col">Stage</th>
          <th scope="col">Count</th>
          <th scope="col">% of first stage</th>
          <th scope="col">% of previous stage</th>
        </tr>
      </thead>
      <tbody>
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1]?.value ?? 0 : s.value;
          return (
            <tr key={s.key}>
              <th scope="row">{s.label}</th>
              <td>{valueFormatter(s.value)}</td>
              <td>{pct(s.value, firstValue)}</td>
              <td>{i === 0 ? "-" : pct(s.value, prev)}</td>
            </tr>
          );
        })}
      </tbody>
    </>
  );

  return (
    <ChartFrame
      title={title}
      description={description}
      height={height ?? Math.max(96, stages.length * ROW_HEIGHT)}
      loading={loading}
      error={error}
      empty={stages.length === 0}
      emptyMessage={emptyMessage}
      className={className}
      data-testid={testId ?? "funnel-chart"}
      table={table}
    >
      {/* Each row pairs the bar with its label + count + conversion %, so the rows double
          as the visible legend — meaning is never conveyed by bar fill alone. */}
      <div data-testid="chart-legend" className="flex h-full flex-col justify-center gap-1.5">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1]?.value ?? 0 : s.value;
          const widthPct = firstValue > 0 ? Math.min(100, (s.value / firstValue) * 100) : 0;
          const ofFirst = pct(s.value, firstValue);
          const ofPrev = i === 0 ? null : pct(s.value, prev);
          return (
            <div
              key={s.key}
              className="grid grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-3"
              title={ofPrev ? `${s.label}: ${valueFormatter(s.value)} · ${ofPrev} of previous stage` : undefined}
            >
              <span className="truncate text-xs font-medium text-fg">{s.label}</span>
              <div className="h-4 overflow-hidden rounded bg-surface">
                <div
                  className="h-full rounded-r"
                  style={{
                    width: `${widthPct}%`,
                    // A non-zero stage always shows at least a sliver of bar.
                    minWidth: s.value > 0 ? 4 : undefined,
                    backgroundColor: s.color ?? getChartColor(0),
                  }}
                />
              </div>
              <span className="min-w-[7.5rem] text-right text-xs tabular-nums text-fg-muted">
                <span className="font-semibold text-fg">{valueFormatter(s.value)}</span>
                <span aria-hidden="true"> · </span>
                <span title={`% of ${firstLabel}`}>{ofFirst}</span>
              </span>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}
FunnelChart.displayName = "FunnelChart";
