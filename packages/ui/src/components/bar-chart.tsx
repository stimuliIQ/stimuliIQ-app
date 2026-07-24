"use client";

import * as React from "react";
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getChartColor } from "../lib/chart-colors";
import { useReducedMotion } from "../lib/use-reduced-motion";
import { ChartFrame, ChartLegend, type ChartLegendItem } from "./chart-frame";

/**
 * BarChart — grouped/stacked, vertical or horizontal bars for CRM analytics dashboards
 * (course-engagement, campaign-performance, attendance by batch, ...), per
 * docs/plans/phase-7.md Wave 1 #5.
 *
 * Note on `orientation`: this prop uses the intuitive meaning (bars stand up vs. lie
 * sideways). Recharts' own `layout` prop is the inverse of that naming (its "horizontal"
 * layout draws vertical bars) — this component translates so callers don't have to know
 * recharts' convention.
 *
 * a11y: same `ChartFrame` shell as LineChart/AreaChart — accessible name, sr-only data
 * table, visible legend pairing color with label.
 *
 * Usage:
 *   <BarChart
 *     title="Leads by source"
 *     data={[{ source: "Organic", count: 120 }, { source: "Paid", count: 80 }]}
 *     categoryKey="source"
 *     series={[{ key: "count", label: "Leads" }]}
 *   />
 *
 *   <BarChart
 *     title="Attendance by batch"
 *     orientation="horizontal"
 *     stacked
 *     data={rows}
 *     categoryKey="batch"
 *     series={[{ key: "present", label: "Present" }, { key: "absent", label: "Absent" }]}
 *   />
 */

export interface BarSeries {
  key: string;
  label: string;
  color?: string;
}

export interface BarChartProps {
  title: string;
  description?: string;
  data: ReadonlyArray<Record<string, string | number>>;
  categoryKey: string;
  categoryLabel?: string;
  series: BarSeries[];
  /** "vertical" (default) = bars stand up; "horizontal" = bars extend sideways. */
  orientation?: "vertical" | "horizontal";
  stacked?: boolean;
  height?: number;
  valueFormatter?: (value: number) => string;
  loading?: boolean;
  error?: string;
  emptyMessage?: string;
  className?: string;
  /** Test hook; defaults to "bar-chart" when omitted. */
  "data-testid"?: string;
}

function toNumber(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface BarTooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
}

function BarTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: BarTooltipPayloadItem[];
  label?: string | number;
  valueFormatter: (value: number) => string;
}): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      {label !== undefined ? <p className="mb-1 font-semibold text-fg">{label}</p> : null}
      <ul className="flex flex-col gap-0.5">
        {payload.map((item, i) => (
          // Recharts tooltip payload items have no stable id — index key is safe (static list per render).
          <li key={i} className="flex items-center gap-1.5 text-fg-muted">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="font-medium text-fg">{item.name}:</span>
            <span>{valueFormatter(toNumber(item.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarChart({
  title,
  description,
  data,
  categoryKey,
  categoryLabel = "Category",
  series,
  orientation = "vertical",
  stacked = false,
  height = 280,
  valueFormatter = (v) => String(v),
  loading = false,
  error,
  emptyMessage,
  className,
  "data-testid": testId,
}: BarChartProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const resolvedSeries = series.map((s, i) => ({ ...s, color: s.color ?? getChartColor(i) }));
  const legendItems: ChartLegendItem[] = resolvedSeries.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
  }));

  const table = (
    <>
      <thead>
        <tr>
          <th scope="col">{categoryLabel}</th>
          {resolvedSeries.map((s) => (
            <th key={s.key} scope="col">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          // Rows are positional category data with no stable id — index key is safe.
          <tr key={i}>
            <th scope="row">{String(row[categoryKey] ?? "")}</th>
            {resolvedSeries.map((s) => (
              <td key={s.key}>{valueFormatter(toNumber(row[s.key]))}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </>
  );

  const axisTickStyle = { fill: "rgb(var(--fg-muted))", fontSize: 12 };
  // Recharts' `layout` naming is the inverse of our `orientation` prop — see file docblock.
  const rechartsLayout = orientation === "horizontal" ? "vertical" : "horizontal";

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
      data-testid={testId ?? "bar-chart"}
      legend={<ChartLegend items={legendItems} />}
      table={table}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={data as Array<Record<string, string | number>>} layout={rechartsLayout}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={orientation === "horizontal"} horizontal={orientation === "vertical"} />
          {orientation === "horizontal" ? (
            <>
              <XAxis type="number" tickFormatter={(v: number) => valueFormatter(v)} tick={axisTickStyle} stroke="rgb(var(--border))" />
              <YAxis type="category" dataKey={categoryKey} tick={axisTickStyle} stroke="rgb(var(--border))" width={96} />
            </>
          ) : (
            <>
              <XAxis type="category" dataKey={categoryKey} tick={axisTickStyle} stroke="rgb(var(--border))" />
              <YAxis type="number" tickFormatter={(v: number) => valueFormatter(v)} tick={axisTickStyle} stroke="rgb(var(--border))" width={64} />
            </>
          )}
          <Tooltip content={<BarTooltip valueFormatter={valueFormatter} />} cursor={{ fill: "rgb(var(--surface))" }} />
          {resolvedSeries.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={stacked ? "stack" : undefined}
              radius={stacked ? undefined : orientation === "horizontal" ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              isAnimationActive={!reducedMotion}
            />
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
BarChart.displayName = "BarChart";
