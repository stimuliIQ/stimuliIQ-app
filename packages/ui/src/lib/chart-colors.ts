/**
 * Chart color palette — categorical, colorblind-safe (Okabe & Ito 2008 derived), themed
 * light/dark via the `--chart-1`..`--chart-6` CSS variables in `styles.css`. Used by every
 * `@repo/ui` chart primitive (KpiCard sparkline, LineChart, AreaChart, BarChart, FunnelChart,
 * DonutChart/PieChart) to assign one hue per series/category.
 *
 * Rule (docs/07-design-system.md §2, CLAUDE.md §3.9): never convey meaning by color alone —
 * every chart pairs each color with a visible text label (legend / axis / data-table), so
 * these values are supplementary, not the sole channel of information.
 */

export const CHART_COLOR_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
] as const;

export type ChartColorVar = (typeof CHART_COLOR_VARS)[number];

/**
 * Resolves a chart color token to a CSS `rgb(var(...))` string, usable directly as an SVG
 * `fill`/`stroke` attribute value passed to recharts. CSS custom properties resolve correctly
 * in SVG presentation attributes in all evergreen browsers.
 */
export function chartColor(varName: ChartColorVar): string {
  return `rgb(var(${varName}))`;
}

/** Cycles through the 6-color categorical palette by index (wraps for series count > 6). */
export function getChartColor(index: number): string {
  const len = CHART_COLOR_VARS.length;
  const safeIndex = ((index % len) + len) % len;
  // Non-null: safeIndex is always in [0, len).
  const varName = CHART_COLOR_VARS[safeIndex] as ChartColorVar;
  return chartColor(varName);
}
