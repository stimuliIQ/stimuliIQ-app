// "My target this month" — the marketing person's own scoreboard on the CRM dashboard.
// Spec: docs/specs/marketing-targets.md, ADR-0067.
//
// VISIBILITY. Rendered only for holders of `marketing_targets.view`, which prisma/seed.ts
// grants to the MARKETING role alone — deliberately kept out of the permission catalog so
// the admin catch-all does not hand it to admins, who have no target of their own. The
// caller gates the whole component (and therefore the fetch); the API is the real
// enforcement (CLAUDE.md §3.5).
//
// THREE NUMBERS PER METRIC, NOT ONE. Target / Completed / Pending are shown together rather
// than as a single percentage, because "17 to go" is the number that changes what somebody
// does today and a percentage is not. Pending is clamped at zero server-side, so beating a
// target reads as "target met", never as a negative backlog.
//
// A METRIC WITH A ZERO TARGET IS HIDDEN, NOT SHOWN AS 0/0. A target row carries both a
// conversions and a revenue number, and either may be 0 meaning "not measured on this". A
// permanently-complete 0/0 card would read as an achievement; showing nothing reads as what
// it is. When BOTH are zero (i.e. no target set at all), the empty state below explains that
// instead — while still showing what the person has actually closed, because closing deals
// against no target is worth seeing.
import * as React from "react";
import { IndianRupee, Target } from "lucide-react";
import { StatusChip, cn, formatPaise } from "@repo/ui";
import type { TargetMetricProgress } from "@repo/types";

import { useMyMarketingTarget } from "../../hooks/use-marketing-targets";

/** A month key like `2026-03` rendered as "March 2026". */
export function formatTargetMonth(month: string): string {
  const [year, mon] = month.split("-");
  const date = new Date(Date.UTC(Number(year), Number(mon) - 1, 1));
  return date.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function MarketingTargetCards(): React.JSX.Element | null {
  const { data, isLoading, isError, refetch } = useMyMarketingTarget();

  if (isLoading) {
    return (
      <section
        aria-busy="true"
        aria-label="Loading your monthly target"
        data-testid="marketing-target-loading"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-lg border border-border bg-surface" />
        ))}
      </section>
    );
  }

  if (isError) {
    return (
      <section
        className="rounded-lg border border-border bg-card p-4"
        data-testid="marketing-target-error"
      >
        <p role="alert" className="text-sm text-danger">
          Couldn&apos;t load your monthly target.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-2 text-sm font-medium text-brand-500 hover:underline"
        >
          Try again
        </button>
      </section>
    );
  }

  if (!data) return null;

  const { conversions, revenuePaise } = data.progress;
  const showConversions = conversions.target > 0;
  const showRevenue = revenuePaise.target > 0;

  return (
    <section aria-labelledby="marketing-target-heading" data-testid="marketing-target-cards">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="marketing-target-heading" className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Target className="size-4 text-brand-500" aria-hidden="true" />
          My target · {formatTargetMonth(data.month)}
        </h2>
        {data.hasTarget ? <TargetVerdict conversions={conversions} revenue={revenuePaise} /> : null}
      </div>

      {!data.hasTarget ? (
        <div
          className="rounded-lg border border-dashed border-border bg-card p-4"
          data-testid="marketing-target-none"
        >
          <p className="text-sm font-medium text-fg">No target set for this month yet.</p>
          <p className="mt-1 text-sm text-fg-muted">
            Your admin sets monthly targets. In the meantime, here is what you have closed:{" "}
            <strong className="font-semibold text-fg">{conversions.completed}</strong>{" "}
            {conversions.completed === 1 ? "conversion" : "conversions"} worth{" "}
            <strong className="font-semibold text-fg">{formatPaise(revenuePaise.completed)}</strong>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {showConversions ? (
            <MetricCard
              label="Conversions"
              metric={conversions}
              format={(n) => String(n)}
              unit="deals closed"
              icon={<Target className="size-4" aria-hidden="true" />}
              data-testid="marketing-target-conversions"
            />
          ) : null}
          {showRevenue ? (
            <MetricCard
              label="Revenue"
              metric={revenuePaise}
              format={formatPaise}
              unit="collected"
              icon={<IndianRupee className="size-4" aria-hidden="true" />}
              data-testid="marketing-target-revenue"
            />
          ) : null}
        </div>
      )}

      {data.hasTarget && data.progress.note ? (
        <p className="mt-2 text-xs text-fg-subtle" data-testid="marketing-target-note">
          {data.progress.note}
        </p>
      ) : null}
    </section>
  );
}
MarketingTargetCards.displayName = "MarketingTargetCards";

/** "On track" / "Target met" — one chip for the metrics the person is actually measured on. */
function TargetVerdict({
  conversions,
  revenue,
}: {
  conversions: TargetMetricProgress;
  revenue: TargetMetricProgress;
}): React.JSX.Element | null {
  // Only metrics with a target count. Someone set a revenue number alone is judged on
  // revenue alone — folding in a conversions card they were never given would make the
  // verdict impossible to earn.
  const measured = [conversions, revenue].filter((m) => m.target > 0);
  if (measured.length === 0) return null;

  const allMet = measured.every((m) => m.met);
  if (allMet) {
    return <StatusChip tone="success" size="sm" label="Target met" data-testid="marketing-target-verdict" />;
  }
  const worst = Math.min(...measured.map((m) => m.percent ?? 0));
  return (
    <StatusChip
      tone={worst >= 0.6 ? "info" : "warning"}
      size="sm"
      label={`${Math.round(worst * 100)}% of target`}
      data-testid="marketing-target-verdict"
    />
  );
}

interface MetricCardProps {
  label: string;
  metric: TargetMetricProgress;
  format: (value: number) => string;
  unit: string;
  icon: React.ReactNode;
  "data-testid": string;
}

function MetricCard({
  label,
  metric,
  format,
  unit,
  icon,
  "data-testid": testId,
}: MetricCardProps): React.JSX.Element {
  const percent = metric.percent ?? 0;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <span className="text-fg-subtle">{icon}</span>
          {label}
        </h3>
        <span className="text-xs text-fg-subtle">{unit}</span>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        <Figure label="Target" value={format(metric.target)} testId={`${testId}-target`} />
        <Figure
          label="Completed"
          value={format(metric.completed)}
          tone="text-brand-600"
          testId={`${testId}-completed`}
        />
        <Figure
          label="Pending"
          // Beating the target leaves nothing pending, and "0" there should read as good
          // news rather than as a missing figure — hence the explicit done state.
          value={metric.met ? "Done" : format(metric.pending)}
          tone={metric.met ? "text-success" : "text-fg"}
          testId={`${testId}-pending`}
        />
      </dl>

      {/* Progress is decorative here: every figure it encodes is already in the list above,
          so it carries aria-hidden rather than duplicating them for a screen reader. */}
      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div
          className={cn("h-full rounded-full transition-[width] duration-base", metric.met ? "bg-success" : "bg-brand-500")}
          style={{ width: `${Math.round(percent * 100)}%` }}
        />
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "text-fg",
  testId,
}: {
  label: string;
  value: string;
  tone?: string;
  testId: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-fg-subtle">{label}</dt>
      <dd className={cn("truncate text-lg font-semibold tabular-nums", tone)} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
