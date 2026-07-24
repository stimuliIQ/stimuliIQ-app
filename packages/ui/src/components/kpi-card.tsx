"use client";

import * as React from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Line, LineChart as RLineChart, ResponsiveContainer } from "recharts";

import { cn } from "../lib/cn";
import { getChartColor } from "../lib/chart-colors";
import { useReducedMotion } from "../lib/use-reduced-motion";
import { Skeleton } from "./skeleton";

/**
 * KpiCard — big-number stat tile for CRM analytics dashboards (revenue, enrollment,
 * lead-funnel, attendance, engagement, campaign KPIs), per docs/plans/phase-7.md Wave 1 #5
 * and docs/07-design-system.md §5/§6 ("KPI row → charts → operational lists").
 *
 * Money-aware: `value`/`delta` are **pre-formatted display strings** (e.g. the caller passes
 * `formatPaise(paise)` or an already-computed percentage string). KpiCard never parses or
 * does arithmetic on them — CLAUDE.md §3.6 ("money is integer minor units, never floats").
 *
 * a11y: the tile is a labelled group whose accessible name is the full "label: value, trend"
 * sentence; the large number/delta text nodes are duplicated visually (aria-hidden) to avoid
 * double-announcing the same content twice via both the group name and browse-mode text flow.
 * The trend is never color-only — it always pairs an arrow icon + text delta. The optional
 * sparkline is purely decorative (the value/delta text already carries the meaningful number)
 * and is `aria-hidden`; it respects `prefers-reduced-motion`.
 *
 * Usage:
 *   <KpiCard
 *     label="Revenue (MTD)"
 *     value={formatPaise(4820000)}
 *     delta="+12.4%"
 *     trendDirection="up"
 *     sparkline={[{ value: 10 }, { value: 14 }, { value: 12 }, { value: 18 }]}
 *   />
 *
 *   // "down" isn't always bad — override the tone explicitly:
 *   <KpiCard label="Refund rate" value="1.2%" delta="-0.4pp" trendDirection="down" trendTone="success" />
 */

export type KpiTrendDirection = "up" | "down" | "flat";
export type KpiTrendTone = "success" | "danger" | "neutral";

export interface KpiSparklinePoint {
  /** Optional point label (e.g. a date) — not rendered, kept for caller bookkeeping. */
  label?: string;
  value: number;
}

export interface KpiCardProps {
  label: string;
  /** Pre-formatted display value — never parsed or computed on by this component. */
  value: string | number;
  /** Pre-formatted trend delta text, e.g. "+12.4%" or "-3 students". */
  delta?: string;
  /** Which arrow icon to show; independent of tone (a "down" trend can be good). */
  trendDirection?: KpiTrendDirection;
  /** Color tone for the delta; defaults from `trendDirection` (up=success, down=danger,
   *  flat=neutral) but the caller can override for metrics where "down" is the good outcome. */
  trendTone?: KpiTrendTone;
  /** Optional decorative trend sparkline. */
  sparkline?: KpiSparklinePoint[];
  icon?: React.ReactNode;
  loading?: boolean;
  error?: string;
  className?: string;
  /** Test hook; defaults to "kpi-card" when omitted. */
  "data-testid"?: string;
}

const defaultToneForDirection: Record<KpiTrendDirection, KpiTrendTone> = {
  up: "success",
  down: "danger",
  flat: "neutral",
};

const trendIcon: Record<KpiTrendDirection, React.ComponentType<{ className?: string }>> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

const trendToneText: Record<KpiTrendTone, string> = {
  success: "text-success",
  danger: "text-danger",
  neutral: "text-fg-muted",
};

export function KpiCard({
  label,
  value,
  delta,
  trendDirection = "flat",
  trendTone,
  sparkline,
  icon,
  loading = false,
  error,
  className,
  "data-testid": testId,
}: KpiCardProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const resolvedTestId = testId ?? "kpi-card";
  const resolvedTone = trendTone ?? defaultToneForDirection[trendDirection];
  const TrendIcon = trendIcon[trendDirection];

  if (loading) {
    return (
      <div
        data-testid={resolvedTestId}
        aria-busy="true"
        aria-label={`Loading ${label}`}
        className={cn("flex flex-col gap-2 rounded-lg border border-border bg-card p-4", className)}
      >
        <Skeleton shape="line" className="h-4 w-1/2" />
        <Skeleton shape="line" className="h-8 w-2/3" />
        <Skeleton shape="line" className="h-3 w-1/3" />
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

  const accessibleName = [
    `${label}: ${value}`,
    delta ? `${trendDirection === "up" ? "up" : trendDirection === "down" ? "down" : "flat"} ${delta}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      data-testid={resolvedTestId}
      role="group"
      aria-label={accessibleName}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-muted">{label}</p>
        {icon ? (
          <span aria-hidden="true" className="text-fg-subtle [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
      </div>

      <div className="flex items-end justify-between gap-3">
        <p aria-hidden="true" className="text-3xl font-bold tabular-nums text-fg">
          {value}
        </p>
        {sparkline && sparkline.length > 1 ? (
          <div aria-hidden="true" className="h-10 w-20 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <RLineChart data={sparkline}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={getChartColor(0)}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={!reducedMotion}
                />
              </RLineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>

      {delta ? (
        <p aria-hidden="true" className={cn("flex items-center gap-1 text-xs font-medium", trendToneText[resolvedTone])}>
          <TrendIcon className="size-3.5 shrink-0" />
          <span>{delta}</span>
        </p>
      ) : null}
    </div>
  );
}
KpiCard.displayName = "KpiCard";
