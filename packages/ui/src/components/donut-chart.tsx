"use client";

import * as React from "react";
import { Cell, Pie, PieChart as RPieChart, ResponsiveContainer, Tooltip } from "recharts";

import { getChartColor } from "../lib/chart-colors";
import { useReducedMotion } from "../lib/use-reduced-motion";
import { ChartFrame, ChartLegend, type ChartLegendItem } from "./chart-frame";

/**
 * DonutChart / PieChart — distribution charts (lead source mix, program mix, payment
 * status mix, ...), per docs/plans/phase-7.md Wave 1 #5. Same component under the hood;
 * `PieChart` is `DonutChart` with `variant="pie"` (no punched-out center).
 *
 * a11y: `ChartFrame` shell (accessible name, sr-only table with value + share %); visible
 * `ChartLegend` pairs each segment's color with its label and percentage share (never
 * color-only). The donut's center total (when `variant="donut"`) is a decorative visual
 * echo of data already in the legend/table, so it is `aria-hidden`.
 *
 * Usage:
 *   <DonutChart
 *     title="Leads by source"
 *     data={[
 *       { key: "organic", label: "Organic", value: 420 },
 *       { key: "paid", label: "Paid ads", value: 260 },
 *       { key: "referral", label: "Referral", value: 90 },
 *     ]}
 *     totalLabel="Total leads"
 *   />
 *
 *   <PieChart title="Payment status" data={statusRows} />
 */

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  title: string;
  description?: string;
  data: DonutSegment[];
  variant?: "donut" | "pie";
  height?: number;
  valueFormatter?: (value: number) => string;
  /** Label shown under the center total, e.g. "Total leads". Donut variant only. */
  totalLabel?: string;
  loading?: boolean;
  error?: string;
  emptyMessage?: string;
  className?: string;
  /** Test hook; defaults to "donut-chart" / "pie-chart" when omitted. */
  "data-testid"?: string;
}

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "-";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

interface PieTooltipPayloadItem {
  name?: string;
  value?: number;
}

function PieTooltip({
  active,
  payload,
  valueFormatter,
  total,
}: {
  active?: boolean;
  payload?: PieTooltipPayloadItem[];
  valueFormatter: (value: number) => string;
  total: number;
}): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  if (!item) return null;
  const value = item.value ?? 0;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-fg">{item.name}</p>
      <p className="text-fg-muted">
        {valueFormatter(value)} ({pct(value, total)})
      </p>
    </div>
  );
}

function DonutOrPieChart({
  title,
  description,
  data,
  variant = "donut",
  height = 260,
  valueFormatter = (v) => String(v),
  totalLabel,
  loading = false,
  error,
  emptyMessage,
  className,
  testId,
}: DonutChartProps & { testId?: string }): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const resolvedTestId = testId ?? (variant === "donut" ? "donut-chart" : "pie-chart");
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const resolvedData = data.map((d, i) => ({ ...d, color: d.color ?? getChartColor(i) }));

  const legendItems: ChartLegendItem[] = resolvedData.map((d) => ({
    key: d.key,
    label: d.label,
    color: d.color,
    value: `${valueFormatter(d.value)} (${pct(d.value, total)})`,
  }));

  const table = (
    <>
      <thead>
        <tr>
          <th scope="col">Segment</th>
          <th scope="col">Value</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        {resolvedData.map((d) => (
          <tr key={d.key}>
            <th scope="row">{d.label}</th>
            <td>{valueFormatter(d.value)}</td>
            <td>{pct(d.value, total)}</td>
          </tr>
        ))}
      </tbody>
    </>
  );

  const innerRadius = variant === "donut" ? "60%" : 0;

  return (
    <ChartFrame
      title={title}
      description={description}
      height={height}
      loading={loading}
      error={error}
      empty={data.length === 0}
      emptyMessage={emptyMessage}
      className={className}
      data-testid={resolvedTestId}
      legend={<ChartLegend items={legendItems} />}
      table={table}
    >
      <div className="relative h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RPieChart>
            <Tooltip content={<PieTooltip valueFormatter={valueFormatter} total={total} />} />
            <Pie
              data={resolvedData}
              dataKey="value"
              nameKey="label"
              innerRadius={innerRadius}
              outerRadius="90%"
              paddingAngle={resolvedData.length > 1 ? 2 : 0}
              isAnimationActive={!reducedMotion}
            >
              {resolvedData.map((d) => (
                <Cell key={d.key} fill={d.color} stroke="rgb(var(--card))" strokeWidth={2} />
              ))}
            </Pie>
          </RPieChart>
        </ResponsiveContainer>
        {variant === "donut" ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          >
            <span className="text-xl font-bold tabular-nums text-fg">{valueFormatter(total)}</span>
            {totalLabel ? <span className="text-xs text-fg-muted">{totalLabel}</span> : null}
          </div>
        ) : null}
      </div>
    </ChartFrame>
  );
}

export function DonutChart(props: DonutChartProps): React.JSX.Element {
  const { "data-testid": testId, ...rest } = props;
  return <DonutOrPieChart {...rest} variant={props.variant ?? "donut"} testId={testId} />;
}
DonutChart.displayName = "DonutChart";

export function PieChart(props: DonutChartProps): React.JSX.Element {
  const { "data-testid": testId, ...rest } = props;
  return <DonutOrPieChart {...rest} variant="pie" testId={testId} />;
}
PieChart.displayName = "PieChart";
