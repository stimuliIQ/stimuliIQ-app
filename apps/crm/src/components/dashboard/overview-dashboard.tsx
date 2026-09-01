// Overview dashboard — role-aware KPI cards + charts (revenue/funnel/
// enrollment) + operational lists (pending payments, open
// tickets). Phase 9 Completion T37
// (docs/plans/phase-9-completion.md). Replaces the P1 placeholder
// (routes/dashboard-route.tsx). RBAC-aware: every section/query only renders
// if `me.permissions` already includes the matching key — CLAUDE.md §3.5,
// the API is the real enforcement, this only avoids showing/fetching what
// would 403.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  AreaChart,
  EmptyState,
  FunnelChart,
  KpiCard,
  PageHeader,
  SlaChip,
  StatusChip,
  formatPaise,
} from "@repo/ui";
import type { MeResponse } from "@repo/types";
import { DollarSign, LifeBuoy, Percent, Receipt, UserPlus } from "lucide-react";

import {
  useEnrollmentTrendReport,
  useFunnelReport,
  useRevenueReport,
} from "../../hooks/use-reports";
import { usePaymentsList } from "../../hooks/use-payments";
import { useTicketsList } from "../../hooks/use-tickets";
import { hasPermission } from "../../lib/permissions";
import { defaultDateRange } from "../../lib/report-dates";
import { PaymentStatusChip } from "../commerce/payment-status-chip";
import { MarketingTargetCards } from "./marketing-target-cards";
import { STAGE_LABEL } from "../leads/lead-stage-chip";

export interface OverviewDashboardProps {
  me: MeResponse | undefined;
}

export function OverviewDashboard({ me }: OverviewDashboardProps): React.JSX.Element {
  const canRevenue = hasPermission(me?.permissions, "reports.revenue.view");
  const canEnrollment = hasPermission(me?.permissions, "reports.enrollment.view");
  const canFunnel = hasPermission(me?.permissions, "reports.funnel.view");
  const canPayments = hasPermission(me?.permissions, "payments.view");
  const canTickets = hasPermission(me?.permissions, "tickets.view");
  // Marketing only. `marketing_targets.view` is seeded to the marketing role alone and kept
  // OUT of the permission catalog, so the admin catch-all never grants it — an admin has no
  // target of their own and would get a permanently-empty card (ADR-0067).
  const canOwnTarget = hasPermission(me?.permissions, "marketing_targets.view");

  const range = React.useMemo(() => defaultDateRange(30), []);

  const revenue = useRevenueReport({ from: range.from, to: range.to }, canRevenue);
  const enrollment = useEnrollmentTrendReport({ from: range.from, to: range.to }, canEnrollment);
  const funnel = useFunnelReport({ from: range.from, to: range.to }, canFunnel);

  // GATED, like the three reports above them. These two were fired unconditionally while
  // `canPayments`/`canTickets` were used only to decide whether to RENDER the result — so a
  // role without them got two guaranteed 403s on every dashboard load, for panels it was
  // never going to be shown. The permission check was already sitting right there; it just
  // wasn't reaching the request.
  const pendingPayments = usePaymentsList({ page: 1, pageSize: 5, status: "created" }, canPayments);
  const openTickets = useTicketsList({ page: 1, pageSize: 5, status: "open" }, canTickets);

  const hasAnyAccess =
    canRevenue || canEnrollment || canFunnel || canPayments || canTickets || canOwnTarget;

  return (
    <div className="space-y-4 md:space-y-5" data-testid="overview-dashboard">
      <PageHeader
        title="Dashboard"
        description="A role-aware snapshot of the last 30 days, plus what needs your attention right now."
      />

      {/* Above the generic KPI row on purpose: for a marketing person this IS the dashboard,
          and burying what they are measured on below three charts they cannot act on would
          make them scroll past it every morning. */}
      {canOwnTarget ? <MarketingTargetCards /> : null}

      {!hasAnyAccess ? (
        <EmptyState
          title="Nothing to show yet"
          description="Ask an Admin/Owner to grant a reports/payments/tickets permission to populate your dashboard."
          data-testid="overview-dashboard-empty"
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {canRevenue ? (
              <KpiCard
                label="Revenue (30d)"
                value={revenue.data ? formatPaise(revenue.data.totalPaise) : "-"}
                icon={<DollarSign />}
                loading={revenue.isLoading}
                error={revenue.isError ? "Couldn't load" : undefined}
                data-testid="overview-kpi-revenue"
              />
            ) : null}
            {canEnrollment ? (
              <KpiCard
                label="Enrollments (30d)"
                value={enrollment.data ? enrollment.data.total : "-"}
                icon={<UserPlus />}
                loading={enrollment.isLoading}
                error={enrollment.isError ? "Couldn't load" : undefined}
                data-testid="overview-kpi-enrollment"
              />
            ) : null}
            {canFunnel ? (
              <KpiCard
                label="Lead conversion (30d)"
                value={funnel.data ? `${(funnel.data.conversionRate * 100).toFixed(1)}%` : "-"}
                icon={<Percent />}
                loading={funnel.isLoading}
                error={funnel.isError ? "Couldn't load" : undefined}
                data-testid="overview-kpi-funnel"
              />
            ) : null}
          </div>

          {canRevenue || canEnrollment || canFunnel ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {canRevenue ? (
                <AreaChart
                  title="Revenue trend"
                  description={`${range.from} – ${range.to}`}
                  data={(revenue.data?.series ?? []).map((p) => ({
                    date: p.periodStart,
                    amount: p.amountPaise,
                  }))}
                  xKey="date"
                  series={[{ key: "amount", label: "Revenue" }]}
                  valueFormatter={(v) => formatPaise(v)}
                  loading={revenue.isLoading}
                  emptyMessage="No captured payments in this range yet."
                  data-testid="overview-revenue-chart"
                />
              ) : null}
              {canEnrollment ? (
                <AreaChart
                  title="Enrollment trend"
                  description={`${range.from} – ${range.to}`}
                  data={(enrollment.data?.series ?? []).map((p) => ({
                    date: p.periodStart,
                    count: p.value,
                  }))}
                  xKey="date"
                  series={[{ key: "count", label: "Enrollments" }]}
                  loading={enrollment.isLoading}
                  emptyMessage="No enrollments in this range yet."
                  data-testid="overview-enrollment-chart"
                />
              ) : null}
              {canFunnel ? (
                <FunnelChart
                  title="Lead funnel"
                  description={`${range.from} – ${range.to}`}
                  stages={(funnel.data?.stages ?? []).map((s) => ({
                    key: s.stage,
                    label: STAGE_LABEL[s.stage] ?? s.stage,
                    value: s.count,
                  }))}
                  loading={funnel.isLoading}
                  emptyMessage="No leads in this range yet."
                  className="lg:col-span-2"
                  data-testid="overview-funnel-chart"
                />
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {canPayments ? (
              <OperationalListCard
                title="Pending payments"
                icon={<Receipt className="size-4" aria-hidden="true" />}
                to="/commerce/payments"
                loading={pendingPayments.isLoading}
                error={pendingPayments.isError}
                empty={(pendingPayments.data?.items.length ?? 0) === 0}
                emptyLabel="No pending payments."
                data-testid="overview-pending-payments"
              >
                <ul className="flex flex-col gap-2">
                  {(pendingPayments.data?.items ?? []).map((payment) => (
                    <li
                      key={payment.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate text-fg">Order {payment.orderId.slice(0, 8)}…</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-fg-muted">{formatPaise(payment.amountPaise)}</span>
                        <PaymentStatusChip status={payment.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              </OperationalListCard>
            ) : null}

            {canTickets ? (
              <OperationalListCard
                title="Open tickets"
                icon={<LifeBuoy className="size-4" aria-hidden="true" />}
                to="/support/tickets"
                loading={openTickets.isLoading}
                error={openTickets.isError}
                empty={(openTickets.data?.items.length ?? 0) === 0}
                emptyLabel="No open tickets."
                data-testid="overview-open-tickets"
              >
                <ul className="flex flex-col gap-2">
                  {(openTickets.data?.items ?? []).map((ticket) => (
                    <li key={ticket.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-fg">{ticket.subject}</span>
                      {ticket.slaDueAt ? (
                        <SlaChip size="sm" dueAt={new Date(ticket.slaDueAt)} />
                      ) : (
                        <StatusChip tone="neutral" size="sm" label={ticket.priority} />
                      )}
                    </li>
                  ))}
                </ul>
              </OperationalListCard>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
OverviewDashboard.displayName = "OverviewDashboard";

interface OperationalListCardProps {
  title: string;
  icon: React.ReactNode;
  to: string;
  loading: boolean;
  error: boolean;
  empty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
  "data-testid": string;
}

function OperationalListCard({
  title,
  icon,
  to,
  loading,
  error,
  empty,
  emptyLabel,
  children,
  "data-testid": testId,
}: OperationalListCardProps): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          {icon}
          {title}
        </h2>
        <Link to={to} className="text-xs font-medium text-brand-500 hover:underline">
          View all
        </Link>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={`Loading ${title}`}>
          <div className="h-4 w-full animate-pulse rounded bg-surface" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface" />
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't load this list.
        </p>
      ) : empty ? (
        <p className="text-sm text-fg-muted">{emptyLabel}</p>
      ) : (
        children
      )}
    </div>
  );
}
