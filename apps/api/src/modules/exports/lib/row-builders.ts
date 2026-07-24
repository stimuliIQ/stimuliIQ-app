// apps/api/src/modules/exports/lib/row-builders.ts
//
// Pure mapping functions: report/entity DTO -> { headers, rows } for CSV/PDF rendering
// (docs/plans/phase-7.md task #8). NO I/O and NO Prisma here (CLAUDE.md §3.3 —
// repository/business-logic layering) — exports.service.ts fetches the already-scoped
// DTO/row via the SAME service methods the on-screen dashboards/lists use (Rule H-2,
// AC-30/31/32), and these functions only decide which of that DTO's fields become CSV
// columns (the "column allowlist", AC-31). Cell values here are RAW (unescaped) —
// exports.service.ts is the only caller and always pipes these rows through
// lib/csv.ts's `rowsToCsv()`/`IncrementalCsvWriter`, which is the ONLY place
// `toCsvCell()`/`csvSafeCell()` are invoked (AC-28/AC-29 single choke-point).
//
// Money fields (amountPaise) are passed through as JS numbers (integer paise) — never
// divided, rounded, or locale-formatted — so csv.ts's `toCsvCell()` emits them as
// plain digit strings, preserving paise integrity end-to-end (CLAUDE.md §3.6).

import type {
  RevenueReportDto,
  EnrollmentTrendDto,
  FunnelReportDto,
  AttendanceReportDto,
  EngagementReportDto,
  CampaignPerformanceDto,
  GamificationParticipationDto,
  ForumHealthReportDto,
  StudentSummary,
  LeadSummary,
  PaymentSummary,
  CampaignAudienceExportRow,
} from "@repo/types";

export interface RowSet {
  headers: string[];
  rows: unknown[][];
}

// ─────────────────────────────────────────────────────────────────────────────
// WS-A1..A8 report-backed types — one row-builder per dashboard DTO.
// ─────────────────────────────────────────────────────────────────────────────

export function revenueRows(dto: RevenueReportDto): RowSet {
  return {
    headers: ["periodStart", "amountPaise", "currency"],
    rows: dto.series.map((p) => [p.periodStart, p.amountPaise, dto.currency]),
  };
}

export function enrollmentsRows(dto: EnrollmentTrendDto): RowSet {
  return {
    headers: ["periodStart", "count"],
    rows: dto.series.map((p) => [p.periodStart, p.value]),
  };
}

export function funnelRows(dto: FunnelReportDto): RowSet {
  return {
    headers: ["stage", "count"],
    rows: dto.stages.map((s) => [s.stage, s.count]),
  };
}

export function attendanceRows(dto: AttendanceReportDto): RowSet {
  const headers = ["batchId", "batchName", "presentCount", "totalCount", "attendancePercent"];
  if (dto.perBatch) {
    return { headers, rows: dto.perBatch.map((b) => [b.batchId, b.batchName, b.presentCount, b.totalCount, b.attendancePercent]) };
  }
  return { headers, rows: [[dto.batchId, "", dto.presentCount, dto.totalCount, dto.attendancePercent]] };
}

export function engagementRows(dto: EngagementReportDto): RowSet {
  return {
    headers: ["moduleId", "lessonId", "title", "order", "completedCount", "enrolledCount", "completionPercent", "isDropOff"],
    rows: dto.lessons.map((l) => [l.moduleId, l.lessonId, l.title, l.order, l.completedCount, l.enrolledCount, l.completionPercent, l.isDropOff]),
  };
}

export function campaignsRows(dto: CampaignPerformanceDto): RowSet {
  return {
    headers: ["campaignId", "campaignName", "sent", "delivered", "read", "failed", "suppressed"],
    rows: [[dto.campaignId, dto.campaignName, dto.metrics.sent, dto.metrics.delivered, dto.metrics.read, dto.metrics.failed, dto.metrics.suppressed]],
  };
}

export function gamificationRows(dto: GamificationParticipationDto): RowSet {
  return {
    headers: ["studentId", "studentName", "studentEmail", "totalXp", "badgeCount"],
    rows: dto.perStudent.map((s) => [s.studentId, s.studentName, s.studentEmail, s.totalXp, s.badgeCount]),
  };
}

export function forumHealthRows(dto: ForumHealthReportDto): RowSet {
  return {
    headers: ["batchId", "threadCount", "postCount", "replyRate", "resolutionRate"],
    rows: [[dto.batchId, dto.threadCount, dto.postCount, dto.replyRate, dto.resolutionRate]],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity-list types — headers only (rows are streamed page-by-page by
// exports.service.ts via IncrementalCsvWriter; one row-mapper per page-row).
// Column sets are the exact allowlists named by AC-31 — never a raw Prisma row.
// ─────────────────────────────────────────────────────────────────────────────

export const STUDENTS_EXPORT_HEADERS = ["id", "name", "email", "phone", "college", "courseType", "year", "city", "status", "createdAt"] as const;

export function studentExportRow(s: StudentSummary): unknown[] {
  return [s.id, s.name, s.email, s.phone, s.college, s.courseType, s.year, s.city, s.status, s.createdAt];
}

export const LEADS_EXPORT_HEADERS = ["id", "name", "phone", "email", "stage", "source", "programInterestTitle", "courseInterest", "college", "language", "branchName", "ownerName", "createdAt"] as const;

export function leadExportRow(l: LeadSummary): unknown[] {
  return [l.id, l.name, l.phone, l.email, l.stage, l.source, l.programInterestTitle, l.courseInterest, l.college, l.language, l.branchName, l.ownerName, l.createdAt];
}

export const PAYMENTS_EXPORT_HEADERS = ["id", "orderId", "provider", "amountPaise", "status", "method", "isManual", "paidAt", "createdAt"] as const;

export function paymentExportRow(p: PaymentSummary): unknown[] {
  return [p.id, p.orderId, p.provider, p.amountPaise, p.status, p.method, p.isManual, p.paidAt, p.createdAt];
}

export const CAMPAIGN_AUDIENCE_EXPORT_HEADERS = ["name", "email", "phone", "source", "stageOrStatus", "programInterest"] as const;

export function campaignAudienceExportRow(r: CampaignAudienceExportRow): unknown[] {
  return [r.name, r.email, r.phone, r.source, r.stageOrStatus, r.programInterest];
}
