// Admin ▸ System Health — the super admin's one-screen answer to "is the platform OK, and how
// big is it?". Backed by GET /crm/system-health (permission `system.health.view`, super admin
// only; the nav hides the entry and the API refuses everyone else).
//
// THREE THINGS THIS SCREEN IS DELIBERATE ABOUT:
//   1. IT SAYS WHAT WAS ACTUALLY CHECKED. The API, Postgres, Redis and the three frontends are
//      pinged live. Third-party providers are judged on configuration only, and their summary
//      says so, because a green tile that implies reachability nobody tested is worse than none.
//   2. A BROKEN API IS A RESULT, NOT A BLANK. If this request fails, that is itself the answer,
//      and the page says so instead of rendering an empty shell.
//   3. NOTHING SENSITIVE ARRIVES HERE. Every string is written by the server: no connection
//      strings, no driver errors, no secrets (see system-health.service.ts).
import * as React from "react";
import { RefreshCw } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  KpiCard,
  PageHeader,
  Skeleton,
  StatusChip,
  type StatusChipTone,
} from "@repo/ui";
import type {
  SystemHealthCategory,
  SystemHealthComponent,
  SystemHealthReport,
  SystemHealthStatus,
} from "@repo/types";

import { SYSTEM_HEALTH_POLL_MS, useSystemHealth } from "../../hooks/use-system-health";

const STATUS_TONE: Record<SystemHealthStatus, StatusChipTone> = {
  healthy: "success",
  degraded: "warning",
  down: "danger",
  unknown: "neutral",
};

const STATUS_LABEL: Record<SystemHealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
  unknown: "Not in use",
};

const SECTIONS: Array<{ category: SystemHealthCategory[]; title: string; hint?: string }> = [
  { category: ["application", "data"], title: "Core services" },
  { category: ["frontend"], title: "Websites", hint: "Checked live from the API server with one request each." },
  {
    category: ["integration"],
    title: "Third-party services & tools",
    hint: "Judged on configuration only. They are not pinged, so a healthy tile means set up, not reachable.",
  },
];

const number = new Intl.NumberFormat("en-IN");

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function SystemHealthWorkspace(): React.JSX.Element {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useSystemHealth();

  return (
    <div className="space-y-6" data-testid="system-health">
      <PageHeader
        title="System Health"
        description={`Live status of the API, database, cache, websites and integrations. Refreshes every ${SYSTEM_HEALTH_POLL_MS / 1000} seconds while this tab is open.`}
        actions={
          <div className="flex items-center gap-3">
            {dataUpdatedAt > 0 ? (
              <span className="text-xs text-fg-muted" data-testid="system-health-checked-at">
                Checked {new Date(dataUpdatedAt).toLocaleTimeString()}
              </span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-busy={isFetching || undefined}
              data-testid="system-health-refresh"
            >
              <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        }
      />

      {isLoading ? <LoadingState /> : null}

      {isError && !data ? (
        <EmptyState
          title="Couldn't read system health"
          description="The API did not answer this request. If you can still see other pages, the health endpoint itself may be failing; if nothing loads, the API is likely down."
          data-testid="system-health-error"
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {data ? <Report report={data} stale={isError} /> : null}
    </div>
  );
}

function LoadingState(): React.JSX.Element {
  return (
    <div className="space-y-4" role="status" aria-live="polite" data-testid="system-health-loading">
      <span className="sr-only">Checking system health</span>
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}

function Report({ report, stale }: { report: SystemHealthReport; stale: boolean }): React.JSX.Element {
  const { overall, students, runtime, traffic } = report;

  return (
    <>
      {stale ? (
        <Alert tone="warning" data-testid="system-health-stale">
          The latest refresh failed, so this is the last result we received.
        </Alert>
      ) : null}

      <Alert
        tone={STATUS_TONE[overall.status] === "neutral" ? "info" : STATUS_TONE[overall.status]}
        title={overall.headline}
        data-testid="system-health-overall"
      >
        {overall.healthyCount} healthy
        {overall.degradedCount > 0 ? `, ${overall.degradedCount} degraded` : ""}
        {overall.downCount > 0 ? `, ${overall.downCount} down` : ""}
        {overall.unknownCount > 0 ? `, ${overall.unknownCount} not in use` : ""}.
      </Alert>

      <section aria-labelledby="sh-students" className="space-y-3">
        <h2 id="sh-students" className="text-base font-semibold">
          Students in the LMS
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total students" value={number.format(students.total)} data-testid="kpi-students-total" />
          <KpiCard label="Active accounts" value={number.format(students.activeAccounts)} />
          <KpiCard label="Signed in, last 24 hours" value={number.format(students.signedInLast24h)} />
          <KpiCard label="Signed in, last 7 days" value={number.format(students.signedInLast7d)} />
          <KpiCard label="New this week" value={number.format(students.newLast7d)} />
          <KpiCard label="New in 30 days" value={number.format(students.newLast30d)} />
          <KpiCard label="Never signed in" value={number.format(students.neverSignedIn)} />
          <KpiCard label="Live sessions (all users)" value={number.format(students.liveSessions)} />
        </div>
      </section>

      {SECTIONS.map((section) => {
        const items = report.components.filter((c) => section.category.includes(c.category));
        if (items.length === 0) return null;
        const headingId = `sh-${section.title.replace(/\W+/g, "-").toLowerCase()}`;
        return (
          <section key={section.title} aria-labelledby={headingId} className="space-y-3">
            <div>
              <h2 id={headingId} className="text-base font-semibold">
                {section.title}
              </h2>
              {section.hint ? <p className="text-sm text-fg-muted">{section.hint}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((component) => (
                <ComponentCard key={component.key} component={component} />
              ))}
            </div>
          </section>
        );
      })}

      <section aria-labelledby="sh-runtime" className="space-y-3">
        <h2 id="sh-runtime" className="text-base font-semibold">
          API process and traffic
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Runtime</CardTitle>
            </CardHeader>
            <CardContent>
              <Facts
                rows={[
                  ["Environment", runtime.environment],
                  ["Node", runtime.nodeVersion],
                  ["Uptime", formatUptime(runtime.uptimeSeconds)],
                  ["Started", new Date(runtime.startedAt).toLocaleString()],
                  ["Memory (RSS)", `${runtime.memoryRssMb} MB`],
                  ["Heap used", `${runtime.heapUsedMb} of ${runtime.heapLimitMb} MB`],
                  ["Event loop delay", `${runtime.eventLoopMeanMs} ms avg, ${runtime.eventLoopP99Ms} ms p99`],
                  ["Server memory in use", `${runtime.hostMemoryUsedPercent}% (${runtime.cpuCount} CPUs)`],
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Requests since the API last restarted</CardTitle>
            </CardHeader>
            <CardContent>
              <Facts
                rows={[
                  ["Total requests", number.format(traffic.totalRequests)],
                  ["Server errors (5xx)", `${number.format(traffic.serverErrors)} (${traffic.serverErrorRatePercent}%)`],
                  ["Client errors (4xx)", number.format(traffic.clientErrors)],
                  ["Average response time", `${traffic.averageResponseMs} ms`],
                  ["In flight right now", String(traffic.inFlight)],
                ]}
              />
              <p className="mt-3 text-xs text-fg-muted">
                These counters reset on every deploy or restart, so a low number after a release is expected.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}

function ComponentCard({ component }: { component: SystemHealthComponent }): React.JSX.Element {
  return (
    <Card data-testid={`health-${component.key}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <CardTitle className="text-sm">{component.name}</CardTitle>
        <StatusChip
          tone={STATUS_TONE[component.status]}
          label={STATUS_LABEL[component.status]}
          size="sm"
          data-testid={`health-${component.key}-status`}
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-fg-muted">
          {component.summary}
          {component.latencyMs !== null ? ` Responded in ${component.latencyMs} ms.` : ""}
        </p>
        {component.details.length > 0 ? (
          <Facts rows={component.details.map((d) => [d.label, d.value] as [string, string])} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Facts({ rows }: { rows: Array<[string, string]> }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-fg-muted">{label}</dt>
          <dd className="text-right font-medium tabular-nums">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
