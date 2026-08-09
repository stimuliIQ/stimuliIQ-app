// apps/api/src/modules/exports/lib/type-view-permission.ts
//
// Shared `ExportEntityType -> required view permission` map, extracted so
// `ExportsService` (AC-34: on-demand export) and `ReportSchedulesService`/
// `ReportScheduleDispatchScheduler` (docs/plans/phase-7.md Wave 2 task #11: scheduled
// report re-evaluation, AC-37) apply the EXACT SAME "must additionally hold the matching
// on-screen view permission" rule from one place, rather than two independently-maintained
// copies drifting apart.

import type { ExportEntityType } from "@repo/types";

/**
 * The view-permission each export/report `type` additionally requires, beyond
 * `reports.export` (on-demand) / `reports.schedule` (recurring) themselves. Mirrors
 * exactly the permission each type's on-screen equivalent (AnalyticsController) route
 * requires.
 */
export const TYPE_VIEW_PERMISSION: Record<ExportEntityType, string> = {
  revenue: "reports.revenue.view",
  enrollments: "reports.enrollment.view",
  funnel: "reports.funnel.view",
  engagement: "reports.engagement.view",
  campaigns: "reports.campaigns.view",
  gamification: "reports.gamification.view",
  "forum-health": "reports.forum.view",
  students: "students.view",
  leads: "leads.view",
  payments: "payments.view",
  "campaign-audience": "campaigns.view",
};
