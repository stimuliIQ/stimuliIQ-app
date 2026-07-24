// Analytics landing page — KPI-card summary (last 30 days) + links into each
// of the 8 WS-A dashboards, docs/plans/phase-7.md Wave 3 #14. RBAC-aware:
// each KPI/tile only renders if `me.permissions` includes the matching
// `reports.*.view` key (CLAUDE.md §3.5 — the API still enforces server-side;
// this just avoids showing/fetching what would 403).
import * as React from "react";
import { Card, CardDescription, CardHeader, CardTitle, EmptyState, KpiCard, PageHeader, formatPaise } from "@repo/ui";
import type { MeResponse } from "@repo/types";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpenCheck,
  CalendarCheck,
  DollarSign,
  GitCompare,
  MessagesSquare,
  Percent,
  Megaphone,
  Receipt,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";

import { useAttendanceReport, useFunnelReport, useRevenueReport, useEnrollmentTrendReport } from "../../hooks/use-reports";
import { hasPermission } from "../../lib/permissions";
import { defaultDateRange } from "../../lib/report-dates";

export interface AnalyticsOverviewProps {
  me: MeResponse | undefined;
}

interface DashboardTile {
  key: string;
  to: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  permission: string;
}

const TILES: DashboardTile[] = [
  { key: "revenue", to: "/analytics/revenue", title: "Revenue", description: "Captured payments reconciled to the ledger.", icon: <DollarSign />, permission: "reports.revenue.view" },
  { key: "enrollment", to: "/analytics/enrollment", title: "Enrollment trend", description: "New enrollments over time.", icon: <UserPlus />, permission: "reports.enrollment.view" },
  { key: "funnel", to: "/analytics/funnel", title: "Lead funnel", description: "Stage counts + win-rate conversion.", icon: <Percent />, permission: "reports.funnel.view" },
  { key: "attendance", to: "/analytics/attendance", title: "Attendance", description: "Present/total across batches.", icon: <CalendarCheck />, permission: "reports.attendance.view" },
  { key: "engagement", to: "/analytics/engagement", title: "Course / video engagement", description: "Per-lesson completion + drop-off.", icon: <BookOpenCheck />, permission: "reports.engagement.view" },
  { key: "campaigns", to: "/analytics/campaigns", title: "Campaign performance", description: "Sent/delivered/read/failed by campaign.", icon: <Megaphone />, permission: "reports.campaigns.view" },
  { key: "gamification", to: "/analytics/gamification", title: "Gamification participation", description: "Active earners, XP, badges (staff view).", icon: <Trophy />, permission: "reports.gamification.view" },
  { key: "forum-health", to: "/analytics/forum-health", title: "Forum health", description: "Threads, posts, reply + resolution rate.", icon: <MessagesSquare />, permission: "reports.forum.view" },
  { key: "cohort", to: "/analytics/cohort", title: "Cohort report", description: "Batch-as-cohort snapshot with attendance drill-in.", icon: <Users />, permission: "reports.enrollment.view" },
  { key: "branch-comparison", to: "/analytics/branch-comparison", title: "Branch comparison", description: "Revenue and enrollments per branch.", icon: <GitCompare />, permission: "reports.revenue.view" },
  { key: "faculty-performance", to: "/analytics/faculty-performance", title: "Faculty performance", description: "Batch load and fill-rate per faculty.", icon: <UserPlus />, permission: "faculty.view" },
  { key: "refunds", to: "/analytics/refunds", title: "Refund report", description: "Refund volume and reasons.", icon: <Receipt />, permission: "refunds.view" },
];

export function AnalyticsOverview({ me }: AnalyticsOverviewProps): React.JSX.Element {
  const canRevenue = hasPermission(me?.permissions, "reports.revenue.view");
  const canEnrollment = hasPermission(me?.permissions, "reports.enrollment.view");
  const canFunnel = hasPermission(me?.permissions, "reports.funnel.view");
  const canAttendance = hasPermission(me?.permissions, "reports.attendance.view");

  const range = React.useMemo(() => defaultDateRange(30), []);

  const revenue = useRevenueReport({ from: range.from, to: range.to }, canRevenue);
  const enrollment = useEnrollmentTrendReport({ from: range.from, to: range.to }, canEnrollment);
  const funnel = useFunnelReport({ from: range.from, to: range.to }, canFunnel);
  const attendance = useAttendanceReport({}, canAttendance);

  const visibleTiles = TILES.filter((tile) => hasPermission(me?.permissions, tile.permission));

  return (
    <div className="space-y-6 md:space-y-8" data-testid="analytics-overview">
      <PageHeader
        title="Analytics"
        description="KPI snapshot for the last 30 days, and links into every detailed dashboard you have access to."
      />

      {visibleTiles.length === 0 ? (
        <EmptyState
          icon={<BarChart3 />}
          title="No analytics access"
          description="Ask an Admin/Owner to grant a reports permission (e.g. reports.revenue.view) to see dashboards here."
          data-testid="analytics-overview-empty"
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {canRevenue ? (
              <KpiCard
                label="Revenue (30d)"
                value={revenue.data ? formatPaise(revenue.data.totalPaise) : "—"}
                icon={<DollarSign />}
                loading={revenue.isLoading}
                error={revenue.isError ? "Couldn't load" : undefined}
                data-testid="overview-revenue-kpi"
              />
            ) : null}
            {canEnrollment ? (
              <KpiCard
                label="Enrollments (30d)"
                value={enrollment.data ? enrollment.data.total : "—"}
                icon={<UserPlus />}
                loading={enrollment.isLoading}
                error={enrollment.isError ? "Couldn't load" : undefined}
                data-testid="overview-enrollment-kpi"
              />
            ) : null}
            {canFunnel ? (
              <KpiCard
                label="Lead conversion (30d)"
                value={funnel.data ? `${(funnel.data.conversionRate * 100).toFixed(1)}%` : "—"}
                icon={<Percent />}
                loading={funnel.isLoading}
                error={funnel.isError ? "Couldn't load" : undefined}
                data-testid="overview-funnel-kpi"
              />
            ) : null}
            {canAttendance ? (
              <KpiCard
                label="Attendance %"
                value={attendance.data ? `${attendance.data.attendancePercent.toFixed(1)}%` : "—"}
                icon={<CalendarCheck />}
                loading={attendance.isLoading}
                error={attendance.isError ? "Couldn't load" : undefined}
                data-testid="overview-attendance-kpi"
              />
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleTiles.map((tile) => (
              <Link key={tile.key} to={tile.to} data-testid={`analytics-tile-${tile.key}`}>
                <Card className="h-full transition-colors duration-fast hover:bg-surface">
                  <CardHeader>
                    <span aria-hidden="true" className="mb-2 inline-flex text-fg-subtle [&_svg]:size-5">
                      {tile.icon}
                    </span>
                    <CardTitle>{tile.title}</CardTitle>
                    <CardDescription>{tile.description}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
      <p className="text-sm text-fg-muted" data-testid="analytics-overview-freshness-note">
        Each dashboard shows a "data as of" freshness indicator — figures are backed by a
        periodically refreshed materialized view, never a live write-path query.
      </p>
    </div>
  );
}
AnalyticsOverview.displayName = "AnalyticsOverview";
