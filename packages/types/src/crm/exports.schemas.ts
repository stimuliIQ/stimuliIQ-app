// Reports + Exports contracts — Phase 7, Wave 1 (docs/plans/phase-7.md task #4).
//
// Covers WS-B (Reports + Exports, docs/specs/phase-7-analytics-hardening.md):
//   - CreateExportRequestDto  — POST /crm/exports (on-demand CSV/PDF trigger)
//   - ExportJobDto            — GET /crm/exports/:id (status polling) + list history
//   - CampaignAudienceExportRowDto — the column allowlist for the campaign-audience
//     export named explicitly in AC-31
//   - CreateReportScheduleDto / ReportScheduleDto — recurring report email (WS-B)
//
// Architecture decisions (LOCKED per docs/specs/phase-7-analytics-hardening.md):
//   Rule H-2 (export scope isolation, AC-30/31/32): every export's `params` is
//   the SAME query shape as the on-screen view it exports — there is no
//   separate, potentially-broader "export query" DTO. This is enforced
//   STRUCTURALLY below: `CreateExportRequestDtoSchema` is a discriminated
//   union keyed by `type`, and each variant's `params` is literally the same
//   zod schema constant used by the matching GET .../reports/* or
//   .../students|leads|payments list endpoint (imported, never re-declared).
//   Rule H-1 (CSV-injection, AC-28/29): enforced by the backend's shared
//   `csvSafeCell()` choke-point — not representable in a zod DTO, but every
//   string-bearing export row DTO in this file is a candidate input to it.
//   AC-35: `downloadUrl` is a signed, short-lived URL (StorageProvider
//   pattern) — this file NEVER models a raw/permanent object key or bucket path.
//   AC-34: export requires `reports.export` (or domain-specific export
//   permission), separate from the `reports.<domain>.view` permission used
//   for the on-screen equivalent — see docs/specs/phase-7-analytics-hardening.md
//   Part 8 permission table.
//
// All schemas are .strict() (CLAUDE.md §3.2 — the global ZodValidationPipe
// strips extras).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import {
  RevenueReportQuerySchema,
  EnrollmentTrendQuerySchema,
  FunnelReportQuerySchema,
  AttendanceReportQuerySchema,
  EngagementReportQuerySchema,
  CampaignPerformanceQuerySchema,
  GamificationParticipationQuerySchema,
  ForumHealthReportQuerySchema,
} from "./reports.schemas.js";
import { ListStudentsQuerySchema } from "./students.schemas.js";
import { ListLeadsQuerySchema } from "./leads.schemas.js";
import { ListPaymentsQuerySchema } from "../commerce/payments.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every exportable domain. The 8 report-backed types mirror WS-A's
 * dashboards 1:1; `students`/`leads`/`payments`/`campaign-audience` are raw
 * entity-list exports (AC-28/AC-31 name these explicitly).
 */
export const ExportEntityTypeSchema = z.enum([
  "revenue",
  "enrollments",
  "funnel",
  "attendance",
  "engagement",
  "campaigns",
  "gamification",
  "forum-health",
  "students",
  "leads",
  "payments",
  "campaign-audience",
]);
export type ExportEntityType = z.infer<typeof ExportEntityTypeSchema>;

/** csv is always available; pdf is offered only for the 8 report-backed types (printable summaries, AC-40). */
export const ExportFormatSchema = z.enum(["csv", "pdf"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export type ExportJobStatus = z.infer<typeof ExportJobStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CreateExportRequestDto — POST /api/v1/crm/exports
//
// Rule H-2 / AC-32: each variant's `params` is the EXACT SAME query schema
// used by the on-screen equivalent (imported, not re-declared) — there is
// structurally no way for the export path to accept a broader filter set
// than the view it mirrors.
// ─────────────────────────────────────────────────────────────────────────

/** Report-backed export: csv or pdf, params = the matching dashboard's query schema. */
function reportExportVariant<TType extends string, TParams extends z.ZodTypeAny>(
  type: TType,
  params: TParams,
) {
  return z
    .object({
      type: z.literal(type),
      format: ExportFormatSchema,
      params,
    })
    .strict();
}

/** Raw entity-list export: csv only (no "printable summary" concept for a row-per-record table). */
function entityExportVariant<TType extends string, TParams extends z.ZodTypeAny>(
  type: TType,
  params: TParams,
) {
  return z
    .object({
      type: z.literal(type),
      format: z.literal("csv"),
      params,
    })
    .strict();
}

/** Export params for the students entity list — same filters as GET /crm/students, minus pagination (an export has no "page"). */
export const ExportStudentsParamsSchema = ListStudentsQuerySchema.omit({ page: true, pageSize: true });
export type ExportStudentsParams = z.infer<typeof ExportStudentsParamsSchema>;

/** Export params for the leads entity list — same filters as GET /crm/leads, minus pagination. */
export const ExportLeadsParamsSchema = ListLeadsQuerySchema.omit({ page: true, pageSize: true });
export type ExportLeadsParams = z.infer<typeof ExportLeadsParamsSchema>;

/** Export params for the payments entity list — same filters as GET /crm/payments, minus pagination. */
export const ExportPaymentsParamsSchema = ListPaymentsQuerySchema.omit({ page: true, pageSize: true });
export type ExportPaymentsParams = z.infer<typeof ExportPaymentsParamsSchema>;

/** Export params for a single campaign's audience segment export (AC-31). */
export const CampaignAudienceExportParamsSchema = z
  .object({
    campaignId: UuidSchema,
  })
  .strict();
export type CampaignAudienceExportParams = z.infer<typeof CampaignAudienceExportParamsSchema>;

export const CreateExportRequestDtoSchema = z.discriminatedUnion("type", [
  reportExportVariant("revenue", RevenueReportQuerySchema),
  reportExportVariant("enrollments", EnrollmentTrendQuerySchema),
  reportExportVariant("funnel", FunnelReportQuerySchema),
  reportExportVariant("attendance", AttendanceReportQuerySchema),
  reportExportVariant("engagement", EngagementReportQuerySchema),
  reportExportVariant("campaigns", CampaignPerformanceQuerySchema),
  reportExportVariant("gamification", GamificationParticipationQuerySchema),
  reportExportVariant("forum-health", ForumHealthReportQuerySchema),
  entityExportVariant("students", ExportStudentsParamsSchema),
  entityExportVariant("leads", ExportLeadsParamsSchema),
  entityExportVariant("payments", ExportPaymentsParamsSchema),
  entityExportVariant("campaign-audience", CampaignAudienceExportParamsSchema),
]);
export type CreateExportRequestDto = z.infer<typeof CreateExportRequestDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CampaignAudienceExportRowDto — column allowlist named explicitly by AC-31
// ─────────────────────────────────────────────────────────────────────────

/**
 * The column allowlist for a `campaign-audience` CSV export row (AC-31).
 * Every column here is safe for Marketing to export; the file MUST NOT
 * contain `answer_key`, payment method detail, or a raw phone number beyond
 * what Marketing is already permitted to view on-screen for that segment.
 */
export const CampaignAudienceExportRowSchema = z
  .object({
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    source: z.string().nullable().describe("Lead source, or 'student' for a converted/enrolled record."),
    stageOrStatus: z.string().describe("Lead pipeline stage, or student enrollment status."),
    programInterest: z.string().nullable(),
  })
  .strict();
export type CampaignAudienceExportRow = z.infer<typeof CampaignAudienceExportRowSchema>;

// ─────────────────────────────────────────────────────────────────────────
// ExportJobDto — GET /api/v1/crm/exports/:id, GET /api/v1/crm/exports (history)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Status/result of an export job (on-demand or scheduled).
 * AC-33: large exports run as a background job — this DTO is the poll target.
 * AC-35: `downloadUrl` is signed + short-lived (StorageProvider pattern);
 * NEVER a raw, permanently-guessable object URL. Null until `status='succeeded'`.
 * AC-36: every export is audit-logged separately (`audit_logs`, entity='export')
 * — this DTO is the job-status projection, not the audit row itself.
 */
export const ExportJobDtoSchema = z
  .object({
    id: UuidSchema,
    type: ExportEntityTypeSchema,
    format: ExportFormatSchema,
    status: ExportJobStatusSchema,
    /** Populated once the job leaves 'queued'/'running'. Null until then. */
    rowCount: z.number().int().min(0).nullable(),
    /** Signed, short-lived download URL. Null until status='succeeded'. */
    downloadUrl: z.string().url().nullable(),
    downloadUrlExpiresAt: IsoDateTimeSchema.nullable().describe("Signed URL expiry. Null until status='succeeded'."),
    /** Human-readable failure reason. Null unless status='failed'. Never a raw stack trace or secret (Rule H-4 pattern extended to exports). */
    error: z.string().nullable(),
    requestedByName: z.string().nullable(),
    requestedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
  })
  .strict();
export type ExportJobDto = z.infer<typeof ExportJobDtoSchema>;

/** GET /api/v1/crm/exports — export history, paginated. */
export const ListExportJobsQuerySchema = z
  .object({
    type: ExportEntityTypeSchema.optional(),
    status: ExportJobStatusSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListExportJobsQuery = z.infer<typeof ListExportJobsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Scheduled reports — CreateReportScheduleDto / ReportScheduleDto
//
// AC-37: the scheduled job re-evaluates the recipient's CURRENT RBAC scope at
// SEND time, not at schedule-creation time — accordingly, this DTO carries NO
// scope/branch/assigned snapshot; scope is always resolved server-side from
// the recipient's live session/role at dispatch. Only the report `type` +
// `params` (the same filter shape as the on-demand export) + delivery
// cadence are stored.
// Scheduling is offered for the 8 report-backed types only (not raw entity
// exports — LOCK-D2: scheduled dispatch reuses the P6 Resend sync-seam).
// ─────────────────────────────────────────────────────────────────────────

export const ReportScheduleFrequencySchema = z.enum(["daily", "weekly", "monthly"]);
export type ReportScheduleFrequency = z.infer<typeof ReportScheduleFrequencySchema>;

/** Outcome of the most recent scheduled run (AC-38/39/edge-case-table). */
export const ReportScheduleRunStatusSchema = z.enum([
  "succeeded",
  "failed",
  "skipped_suppressed",
  "sent_no_data",
]);
export type ReportScheduleRunStatus = z.infer<typeof ReportScheduleRunStatusSchema>;

function reportScheduleVariant<TType extends string, TParams extends z.ZodTypeAny>(
  type: TType,
  params: TParams,
) {
  return z
    .object({
      type: z.literal(type),
      format: ExportFormatSchema,
      frequency: ReportScheduleFrequencySchema,
      /** Null/absent = send to the creator's own registered email. */
      recipientEmail: z.string().email().nullable().optional(),
      params,
    })
    .strict();
}

/** POST /api/v1/crm/reports/schedules */
export const CreateReportScheduleDtoSchema = z.discriminatedUnion("type", [
  reportScheduleVariant("revenue", RevenueReportQuerySchema),
  reportScheduleVariant("enrollments", EnrollmentTrendQuerySchema),
  reportScheduleVariant("funnel", FunnelReportQuerySchema),
  reportScheduleVariant("attendance", AttendanceReportQuerySchema),
  reportScheduleVariant("engagement", EngagementReportQuerySchema),
  reportScheduleVariant("campaigns", CampaignPerformanceQuerySchema),
  reportScheduleVariant("gamification", GamificationParticipationQuerySchema),
  reportScheduleVariant("forum-health", ForumHealthReportQuerySchema),
]);
export type CreateReportScheduleDto = z.infer<typeof CreateReportScheduleDtoSchema>;

/** PATCH /api/v1/crm/reports/schedules/:id — cadence/recipient/active toggle only; `type`/`params` are immutable (delete + recreate to change what's reported). */
export const UpdateReportScheduleDtoSchema = z
  .object({
    frequency: ReportScheduleFrequencySchema.optional(),
    recipientEmail: z.string().email().nullable().optional(),
    /** Set false to pause the schedule without deleting it. */
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateReportScheduleDto = z.infer<typeof UpdateReportScheduleDtoSchema>;

/** GET /api/v1/crm/reports/schedules/:id, list item shape. */
export const ReportScheduleDtoSchema = z
  .object({
    id: UuidSchema,
    type: ExportEntityTypeSchema,
    format: ExportFormatSchema,
    frequency: ReportScheduleFrequencySchema,
    recipientEmail: z.string().email().nullable(),
    active: z.boolean(),
    nextRunAt: IsoDateTimeSchema,
    lastRunAt: IsoDateTimeSchema.nullable(),
    lastStatus: ReportScheduleRunStatusSchema.nullable(),
    /** Human-readable failure reason for the last run. Null unless lastStatus='failed'. Never a raw provider error/secret. */
    lastError: z.string().nullable(),
    createdByName: z.string(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type ReportScheduleDto = z.infer<typeof ReportScheduleDtoSchema>;

/** GET /api/v1/crm/reports/schedules — list, paginated. */
export const ListReportSchedulesQuerySchema = z
  .object({
    type: ExportEntityTypeSchema.optional(),
    active: z.coerce.boolean().optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListReportSchedulesQuery = z.infer<typeof ListReportSchedulesQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time assertions — no raw storage internals or secrets in any
// export/report response DTO.
// ─────────────────────────────────────────────────────────────────────────

type ForbiddenExportField =
  | "s3Key"
  | "objectKey"
  | "bucketName"
  | "signingSecret"
  | "apiKey"
  | "awsSecretAccessKey"
  | "resendApiKey"
  | "answerKey"
  | "cardNumber"
  | "cvv"
  | "passwordHash";

type AssertNoForbiddenFields<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "FORBIDDEN FIELD DETECTED IN EXPORT/REPORT DTO" : "ok",
] extends ["ok"]
  ? true
  : never;

type _AssertExportJobNoSecret = AssertNoForbiddenFields<ExportJobDto, ForbiddenExportField>;
type _AssertCampaignAudienceRowNoSecret = AssertNoForbiddenFields<
  CampaignAudienceExportRow,
  ForbiddenExportField
>;
type _AssertReportScheduleNoSecret = AssertNoForbiddenFields<ReportScheduleDto, ForbiddenExportField>;

const _assertExportJob: _AssertExportJobNoSecret = true;
const _assertCampaignAudienceRow: _AssertCampaignAudienceRowNoSecret = true;
const _assertReportSchedule: _AssertReportScheduleNoSecret = true;

export type {
  _AssertExportJobNoSecret,
  _AssertCampaignAudienceRowNoSecret,
  _AssertReportScheduleNoSecret,
};
void _assertExportJob;
void _assertCampaignAudienceRow;
void _assertReportSchedule;
