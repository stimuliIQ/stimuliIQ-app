"use client";

import * as React from "react";
import {
  Area,
  AreaChart as RAreaChart,
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getChartColor } from "../lib/chart-colors";
import { useReducedMotion } from "../lib/use-reduced-motion";
import { ChartFrame, ChartLegend, type ChartLegendItem } from "./chart-frame";

/**
 * LineChart / AreaChart — tokenized, multi-series time-series charts for CRM analytics
 * dashboards (revenue trend, enrollment trend, attendance over time, ...), per
 * docs/plans/phase-7.md Wave 1 #5. Both share the same data/series contract and accessible
 * shell (`ChartFrame`) — pick the variant that fits the story (Area for cumulative/volume,
 * Line for rate/count trends).
 *
 * a11y: wrapped in `ChartFrame` — accessible name via role="img"+aria-label, sr-only
 * `<table>` fallback with every point, and a visible `ChartLegend` pairing each series'
 * color with its label (never color-only). Axis ticks and grid use theme tokens (AA in both
 * light/dark). `prefers-reduced-motion` disables the line/area draw-in animation.
 *
 * Usage:
 *   <LineChart
 *     title="Revenue trend"
 *     description="Last 30 days"
 *     data={[{ date: "Jul 1", revenue: 42000, refunds: 1200 }, ...]}
 *     xKey="date"
 *     series={[
 *       { key: "revenue", label: "Revenue" },
 *       { key: "refunds", label: "Refunds" },
 *     ]}
 *     valueFormatter={(v) => formatPaise(v)}
 *   />
 *
 *   <AreaChart title="Enrollments" data={rows} xKey="week" series={[{ key: "count", label: "Enrollments" }]} />
 */

export interface TrendSeries {
  key: string;
  label: string;
  /** Override the auto-assigned palette color, e.g. a resolved `rgb(var(--chart-2))`. */
  color?: string;
}

export interface TrendChartProps {
  title: string;
  description?: string;
  data: ReadonlyArray<Record<string, string | number>>;
  /** Field in each data row used as the x-axis category (e.g. a date string). */
  xKey: string;
  /** Column header for the x-axis field in the sr-only data table. Default "Period". */
  xLabel?: string;
  series: TrendSeries[];
  height?: number;
  valueFormatter?: (value: number) => string;
  xFormatter?: (value: string | number) => string;
  loading?: boolean;
  error?: string;
  emptyMessage?: string;
  className?: string;
  /** Test hook; defaults to "line-chart" / "area-chart" when omitted. */
  "data-testid"?: string;
}

function toNumber(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function TrendChartBase({
  variant,
  title,
  description,
  data,
  xKey,
  xLabel = "Period",
  series,
  height = 280,
  valueFormatter = (v) => String(v),
  xFormatter = (v) => String(v),
  loading = false,
  error,
  emptyMessage,
  className,
  testId,
}: TrendChartProps & { variant: "line" | "area"; testId?: string }): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const resolvedTestId = testId ?? (variant === "line" ? "line-chart" : "area-chart");

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
          <th scope="col">{xLabel}</th>
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
            <th scope="row">{xFormatter(row[xKey] ?? "")}</th>
            {resolvedSeries.map((s) => (
              <td key={s.key}>{valueFormatter(toNumber(row[s.key]))}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </>
  );

  const axisTickStyle = { fill: "rgb(var(--fg-muted))", fontSize: 12 };

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
      <ResponsiveContainer width="100%" height="100%">
        {variant === "line" ? (
          <RLineChart data={data as Array<Record<string, string | number>>}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} tickFormatter={xFormatter} tick={axisTickStyle} stroke="rgb(var(--border))" />
            <YAxis tickFormatter={(v: number) => valueFormatter(v)} tick={axisTickStyle} stroke="rgb(var(--border))" width={64} />
            <Tooltip content={<TrendTooltip valueFormatter={valueFormatter} xFormatter={xFormatter} />} />
            {resolvedSeries.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={!reducedMotion}
              />
            ))}
          </RLineChart>
        ) : (
          <RAreaChart data={data as Array<Record<string, string | number>>}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} tickFormatter={xFormatter} tick={axisTickStyle} stroke="rgb(var(--border))" />
            <YAxis tickFormatter={(v: number) => valueFormatter(v)} tick={axisTickStyle} stroke="rgb(var(--border))" width={64} />
            <Tooltip content={<TrendTooltip valueFormatter={valueFormatter} xFormatter={xFormatter} />} />
            {resolvedSeries.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.18}
                strokeWidth={2}
                isAnimationActive={!reducedMotion}
              />
            ))}
          </RAreaChart>
        )}
      </ResponsiveContainer>
    </ChartFrame>
  );
}

interface TrendTooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
}

function TrendTooltip({
  active,
  payload,
  label,
  valueFormatter,
  xFormatter,
}: {
  active?: boolean;
  payload?: TrendTooltipPayloadItem[];
  label?: string | number;
  valueFormatter: (value: number) => string;
  xFormatter: (value: string | number) => string;
}): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-fg">{xFormatter(label ?? "")}</p>
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

export function LineChart(props: TrendChartProps): React.JSX.Element {
  const { "data-testid": testId, ...rest } = props;
  return <TrendChartBase {...rest} variant="line" testId={testId} />;
}
LineChart.displayName = "LineChart";

export function AreaChart(props: TrendChartProps): React.JSX.Element {
  const { "data-testid": testId, ...rest } = props;
  return <TrendChartBase {...rest} variant="area" testId={testId} />;
}
AreaChart.displayName = "AreaChart";
