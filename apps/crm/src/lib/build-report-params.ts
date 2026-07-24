// Builds the `params` object for a `CreateExportRequestDto` /
// `CreateReportScheduleDto` from the shared `ReportParamsBag` UI state
// (docs/plans/phase-7.md Wave 3 task #15). Shared by the Export creation
// drawer and the Report schedule creation drawer so the type -> params
// mapping (Rule H-2 — same filters as the on-screen view) lives in exactly
// one place.
import type { ExportEntityType } from "@repo/types";

import type { ReportParamsBag } from "../components/reports/report-params-fields";

export function buildExportParams(type: ExportEntityType, params: ReportParamsBag): Record<string, unknown> {
  switch (type) {
    case "revenue":
      return { from: params.from, to: params.to, branchId: params.branchId || undefined };
    case "enrollments":
      return {
        from: params.from,
        to: params.to,
        granularity: params.granularity || undefined,
        branchId: params.branchId || undefined,
      };
    case "funnel":
      return { from: params.from, to: params.to, branchId: params.branchId || undefined };
    case "attendance":
      return { batchId: params.batchId || undefined, from: params.from || undefined, to: params.to || undefined };
    case "engagement":
      return { programId: params.programId, batchId: params.batchId || undefined };
    case "campaigns":
      return { campaignId: params.campaignId };
    case "gamification":
      return { batchId: params.batchId || undefined };
    case "forum-health":
      return { batchId: params.batchId || undefined };
    case "students":
      return {
        search: params.search || undefined,
        status: params.status || undefined,
        courseType: params.courseType || undefined,
      };
    case "leads":
      return {
        search: params.search || undefined,
        source: params.source || undefined,
        stage: params.stage || undefined,
      };
    case "payments":
      return {
        orderId: params.orderId || undefined,
        status: params.status || undefined,
        from: params.from ? new Date(params.from).toISOString() : undefined,
        to: params.to ? new Date(params.to).toISOString() : undefined,
      };
    case "campaign-audience":
      return { campaignId: params.campaignId };
    default:
      return {};
  }
}
