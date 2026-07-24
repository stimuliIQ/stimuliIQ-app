// KPI Dashboard contracts — Phase 7, Wave 1 (docs/plans/phase-7.md task #4).
//
// Covers WS-A (KPI Dashboards, docs/specs/phase-7-analytics-hardening.md):
//   WS-A1 Revenue                → RevenueReport
//   WS-A2 Enrollment trend       → EnrollmentTrendReport
//   WS-A3 Lead funnel/conversion → FunnelReport
//   WS-A4 Attendance             → AttendanceReport
//   WS-A5 Course/video engagement → EngagementReport
//   WS-A6 Campaign performance   → CampaignPerformanceReport
//   WS-A7 Gamification participation → GamificationParticipationReport
//   WS-A8 Forum health           → ForumHealthReport
//
// Architecture decisions (LOCKED per docs/specs/phase-7-analytics-hardening.md):
//   LOCK-D1: every dashboard is computed off a materialized view / read
//   replica, never the live write-path DB. Every response therefore carries a
//   `ReportFreshnessSchema` (`asOf` + `stale`) so the UI can show "data as of
//   HH:MM" instead of silently presenting stale numbers as current (Part 4
//   edge-case table: "Materialized view has not refreshed" / "refresh job
//   failed" — 200 with a visible staleness warning, never a 500).
//
// SCOPE (server-enforced, never client-selected — CLAUDE.md §3.5):
//   None of the query DTOs below carry a tenant selector. Where a dashboard
//   accepts an explicit `branchId`/`batchId` narrowing filter (e.g. an Admin
//   picking one branch), that filter is ADDITIONAL to — never a replacement
//   for — the caller's own resolved scope (all|branch|assigned|own): the
//   service intersects the requested filter with the caller's allowed set and
//   returns 404 (not 403) for an out-of-scope id (IDOR-safe, docs/03 §9,
//   Part 4 edge-case table: "Branch filter selects a branch the caller cannot
//   access → 404, not 403").
//
// Money: integer paise + explicit ISO-4217 currency (CLAUDE.md §3.6, AC-1).
// Never a float. Every series/list DTO has an explicit empty-result shape —
// a zero-activity bucket is `0`, never an omitted point (AC-9).
//
// All schemas are .strict() (CLAUDE.md §3.2 — the global ZodValidationPipe
// strips extras; the frontend gets the exact same shape).

import { z } from "zod";
import { UuidSchema, IsoDateSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { LeadStageSchema } from "./leads.schemas.js";
import { CampaignMetricsDtoSchema } from "../engagement/campaigns.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Shared building blocks
// ─────────────────────────────────────────────────────────────────────────

export const ReportGranularitySchema = z.enum(["daily", "weekly", "monthly"]);
export type ReportGranularity = z.infer<typeof ReportGranularitySchema>;

/**
 * Common date-range query shape for the headline dashboards (revenue,
 * enrollment trend, funnel). `from`/`to` are date-only (tenant-timezone),
 * inclusive of the full day at BOTH ends (AC-4).
 *
 * Cross-field validation (`from <= to`) is a BUSINESS RULE, not a zod shape
 * check: the service throws 422 `INVALID_DATE_RANGE` before any query runs
 * (AC-4). It is intentionally NOT encoded as a zod `.refine()` here — a zod
 * shape failure is mapped to 400 by the global ZodValidationPipe, and AC-4
 * requires 422 specifically, so backend-builder's service layer owns that check.
 */
export const ReportDateRangeQuerySchema = z.object({
  from: IsoDateSchema.describe("Inclusive lower bound (tenant-timezone date), e.g. 2026-06-01."),
  to: IsoDateSchema.describe("Inclusive upper bound (tenant-timezone date), e.g. 2026-06-30."),
});
export type ReportDateRangeQuery = z.infer<typeof ReportDateRangeQuerySchema>;

/**
 * One point in a count/rate time-series chart. `value` is ALWAYS present —
 * a bucket with zero activity is `0`, never an omitted point (AC-9), so the
 * chart never silently skips a period.
 */
export const ReportSeriesPointSchema = z
  .object({
    /** Bucket start date (ISO date, tenant-timezone). */
    periodStart: IsoDateSchema,
    value: z.number().describe("Metric value for this bucket. 0 for an empty bucket — never omitted."),
  })
  .strict();
export type ReportSeriesPoint = z.infer<typeof ReportSeriesPointSchema>;

/** Money variant of `ReportSeriesPointSchema` — value is integer paise. */
export const ReportMoneySeriesPointSchema = z
  .object({
    periodStart: IsoDateSchema,
    amountPaise: z
      .number()
      .int()
      .describe("Integer paise for this bucket. 0 for an empty bucket — never omitted."),
  })
  .strict();
export type ReportMoneySeriesPoint = z.infer<typeof ReportMoneySeriesPointSchema>;

/**
 * Freshness fields spread into every dashboard response (LOCK-D1).
 *   `asOf`   — the backing materialized view's last successful
 *              `REFRESH CONCURRENTLY` timestamp.
 *   `stale`  — true when the last refresh ATTEMPT failed and this response is
 *              serving the last-known-good snapshot (Part 4 edge case: the
 *              dashboard must surface this, never silently show old data as
 *              current, and must never 500 on a failed refresh).
 */
export const ReportFreshnessSchema = z.object({
  asOf: IsoDateTimeSchema.describe("Timestamp of the last successful materialized-view refresh."),
  stale: z
    .boolean()
    .describe("True when the last refresh attempt failed and this is a last-known-good snapshot."),
});
export type ReportFreshness = z.infer<typeof ReportFreshnessSchema>;

/** ISO-4217 currency code, e.g. `INR`. Reused wherever a report totals money (CLAUDE.md §3.6). */
const CurrencyCodeSchema = z.string().length(3).describe("ISO-4217 currency code, e.g. INR.");

// ─────────────────────────────────────────────────────────────────────────
// WS-A1: Revenue dashboard — GET /api/v1/crm/reports/revenue
// ─────────────────────────────────────────────────────────────────────────

/** GET /api/v1/crm/reports/revenue?from=&to=[&branchId=] */
export const RevenueReportQuerySchema = ReportDateRangeQuerySchema.extend({
  /** Optional narrowing filter. ADDITIONAL to the caller's resolved scope, never a replacement for it (IDOR → 404). */
  branchId: UuidSchema.optional(),
}).strict();
export type RevenueReportQuery = z.infer<typeof RevenueReportQuerySchema>;

/** Per-program revenue breakdown row. */
export const RevenueByProgramRowSchema = z
  .object({
    programId: UuidSchema,
    programTitle: z.string(),
    amountPaise: z.number().int().min(0),
  })
  .strict();
export type RevenueByProgramRow = z.infer<typeof RevenueByProgramRowSchema>;

/**
 * GET /api/v1/crm/reports/revenue response.
 *
 * AC-1 (HEADLINE): `totalPaise` equals
 * `SUM(payments.amount_paise) WHERE status='captured' AND paid_at BETWEEN range AND tenant_id=T`.
 * Never diverges from a direct ledger query by even one paisa. AC-5: a zero-payment
 * range is a valid 200 with `totalPaise=0` and an all-zero/empty breakdown — never 404/500.
 */
export const RevenueReportDtoSchema = ReportFreshnessSchema.extend({
  from: IsoDateSchema,
  to: IsoDateSchema,
  currency: CurrencyCodeSchema,
  totalPaise: z.number().int().min(0).describe("SUM(captured payments) in range, integer paise. Never a float."),
  series: z.array(ReportMoneySeriesPointSchema).describe("Daily revenue buckets across the range. Empty array if range predates any data."),
  byProgram: z.array(RevenueByProgramRowSchema).describe("Revenue breakdown by program. Empty array for a zero-payment range."),
}).strict();
export type RevenueReportDto = z.infer<typeof RevenueReportDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// WS-A2: Enrollment trend dashboard — GET /api/v1/crm/reports/enrollments
// ─────────────────────────────────────────────────────────────────────────

/** GET /api/v1/crm/reports/enrollments?from=&to=[&granularity=][&branchId=] */
export const EnrollmentTrendQuerySchema = ReportDateRangeQuerySchema.extend({
  granularity: ReportGranularitySchema.optional().describe("Requested bucket size. Server may auto-coarsen for very large ranges (Part 4 edge case) — the actual bucket used is echoed back in the response."),
  branchId: UuidSchema.optional(),
}).strict();
export type EnrollmentTrendQuery = z.infer<typeof EnrollmentTrendQuerySchema>;

/**
 * GET /api/v1/crm/reports/enrollments response.
 * AC-7: per-period counts equal `COUNT(enrollments) WHERE enrolled_at BETWEEN range AND tenant_id=T`,
 * grouped identically to `granularity` below. AC-9: a zero-enrollment bucket is present with value 0.
 */
export const EnrollmentTrendDtoSchema = ReportFreshnessSchema.extend({
  from: IsoDateSchema,
  to: IsoDateSchema,
  /** The bucket size actually used to group `series` (may differ from the requested granularity — server auto-coarsens very large ranges). */
  granularity: ReportGranularitySchema,
  series: z.array(ReportSeriesPointSchema),
  total: z.number().int().min(0).describe("SUM of series values — convenience total for the range."),
}).strict();
export type EnrollmentTrendDto = z.infer<typeof EnrollmentTrendDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// WS-A3: Lead funnel / conversion dashboard — GET /api/v1/crm/reports/funnel
// ─────────────────────────────────────────────────────────────────────────

/** GET /api/v1/crm/reports/funnel?from=&to=[&branchId=] */
export const FunnelReportQuerySchema = ReportDateRangeQuerySchema.extend({
  /** Counsellor's own-scope is resolved server-side from the session — never accepted as a query param. */
  branchId: UuidSchema.optional(),
}).strict();
export type FunnelReportQuery = z.infer<typeof FunnelReportQuerySchema>;

export const FunnelStageCountSchema = z
  .object({
    stage: LeadStageSchema,
    count: z.number().int().min(0),
  })
  .strict();
export type FunnelStageCount = z.infer<typeof FunnelStageCountSchema>;

/**
 * GET /api/v1/crm/reports/funnel response.
 * AC-10: each stage's count equals `COUNT(leads) WHERE stage=X AND created_at BETWEEN range AND tenant_id=T`;
 * `conversionRate` = `wonCount / totalLeads` and matches a direct recomputation.
 */
export const FunnelReportDtoSchema = ReportFreshnessSchema.extend({
  from: IsoDateSchema,
  to: IsoDateSchema,
  stages: z.array(FunnelStageCountSchema).describe("One row per LeadStage. A stage with zero leads is still present with count=0."),
  totalLeads: z.number().int().min(0),
  wonCount: z.number().int().min(0),
  conversionRate: z.number().min(0).max(1).describe("wonCount / totalLeads. 0 when totalLeads=0 (never NaN/divide-by-zero)."),
}).strict();
export type FunnelReportDto = z.infer<typeof FunnelReportDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// WS-A4: Attendance dashboard — GET /api/v1/crm/reports/attendance
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/crm/reports/attendance[?batchId=][&from=][&to=]
 * No `batchId` + Admin/Owner (all-scope) = aggregate across every batch in
 * the tenant (AC-16). Faculty MUST supply a `batchId` they are assigned to —
 * an unassigned batch returns 404 (AC-15, IDOR-safe).
 */
export const AttendanceReportQuerySchema = z
  .object({
    batchId: UuidSchema.optional(),
    from: IsoDateSchema.optional(),
    to: IsoDateSchema.optional(),
  })
  .strict();
export type AttendanceReportQuery = z.infer<typeof AttendanceReportQuerySchema>;

export const AttendanceByBatchRowSchema = z
  .object({
    batchId: UuidSchema,
    batchName: z.string(),
    presentCount: z.number().int().min(0),
    totalCount: z.number().int().min(0),
    attendancePercent: z.number().min(0).max(100),
  })
  .strict();
export type AttendanceByBatchRow = z.infer<typeof AttendanceByBatchRowSchema>;

/**
 * GET /api/v1/crm/reports/attendance response.
 * AC-14: `attendancePercent` equals `COUNT(status='present') / COUNT(*)
 * WHERE enrollment_id IN (batch's enrollments)`, matching a direct recomputation.
 */
export const AttendanceReportDtoSchema = ReportFreshnessSchema.extend({
  /** Null when the caller queried the all-batch aggregate (Admin/Owner, no batchId filter). */
  batchId: UuidSchema.nullable(),
  presentCount: z.number().int().min(0),
  totalCount: z.number().int().min(0),
  attendancePercent: z.number().min(0).max(100).describe("0 when totalCount=0 (never NaN)."),
  /** Populated ONLY for the all-batch aggregate view (batchId=null). Null for a single-batch query. */
  perBatch: z.array(AttendanceByBatchRowSchema).nullable(),
}).strict();
export type AttendanceReportDto = z.infer<typeof AttendanceReportDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// WS-A5: Course/video engagement dashboard — GET /api/v1/crm/reports/engagement
// ─────────────────────────────────────────────────────────────────────────

/** GET /api/v1/crm/reports/engagement?programId=[&batchId=] */
export const EngagementReportQuerySchema = z
  .object({
    programId: UuidSchema,
    /** Faculty MUST narrow to an assigned batch; Admin/Owner may omit for the whole-program view (AC-19). */
    batchId: UuidSchema.optional(),
  })
  .strict();
export type EngagementReportQuery = z.infer<typeof EngagementReportQuerySchema>;

/** Per-lesson completion row, returned in curriculum order (AC-18). */
export const LessonEngagementRowSchema = z
  .object({
    lessonId: UuidSchema,
    moduleId: UuidSchema,
    title: z.string(),
    /** Curriculum order within the module (matches `ModuleNode.lessons[].order`). */
    order: z.number().int(),
    completedCount: z.number().int().min(0),
    enrolledCount: z.number().int().min(0),
    completionPercent: z.number().min(0).max(100).describe("0 when enrolledCount=0 (never NaN)."),
    /** True when this lesson crosses the configured drop-off threshold vs. its predecessor (AC-18). */
    isDropOff: z.boolean(),
  })
  .strict();
export type LessonEngagementRow = z.infer<typeof LessonEngagementRowSchema>;

/**
 * GET /api/v1/crm/reports/engagement response.
 * AC-17: completion % per lesson equals `COUNT(status='completed') / COUNT(enrolled students)`.
 * AC-18: lessons are in curriculum order; `dropOffLessonId` names the first lesson
 * crossing the configured drop-off threshold (null if none crossed).
 */
export const EngagementReportDtoSchema = ReportFreshnessSchema.extend({
  programId: UuidSchema,
  batchId: UuidSchema.nullable(),
  lessons: z.array(LessonEngagementRowSchema).describe("Curriculum order. Empty array if the program has no lessons yet."),
  dropOffLessonId: UuidSchema.nullable().describe("First lesson crossing the drop-off threshold. Null if none crossed."),
}).strict();
export type EngagementReportDto = z.infer<typeof EngagementReportDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// WS-A6: Campaign performance dashboard — GET /api/v1/crm/reports/campaigns
// ─────────────────────────────────────────────────────────────────────────

/** GET /api/v1/crm/reports/campaigns?campaignId= */
export const CampaignPerformanceQuerySchema = z
  .object({
    campaignId: UuidSchema,
  })
  .strict();
export type CampaignPerformanceQuery = z.infer<typeof CampaignPerformanceQuerySchema>;

/**
 * GET /api/v1/crm/reports/campaigns response.
 * AC-20: `sent`/`delivered`/`read`/`failed` equal `COUNT(campaign_recipients)
 * GROUP BY status WHERE campaign_id=C`, matching `campaigns.metrics` EXACTLY
 * (no drift between the cached metrics JSON and a live recount) — this is why
 * `metrics` below reuses `CampaignMetricsDtoSchema` verbatim (@repo/types
 * engagement/campaigns.schemas.ts) rather than redefining an equivalent shape
 * (CLAUDE.md §3.2 — one schema per shape, no dupes).
 * AC-22: unknown/cross-tenant `campaignId` → 404 (tenant-scoped lookup, not a
 * cross-tenant 403 that would confirm existence).
 */
export const CampaignPerformanceDtoSchema = ReportFreshnessSchema.extend({
  campaignId: UuidSchema,
  campaignName: z.string(),
  metrics: CampaignMetricsDtoSchema,
}).strict();
export type CampaignPerformanceDto = z.infer<typeof CampaignPerformanceDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// WS-A7: Gamification participation dashboard — GET /api/v1/crm/reports/gamification
//
// NOTE ON PII (AC-24, AC-25): unlike the PII-minimal, opt-in
// `LeaderboardEntryDtoSchema` (student-facing, @repo/types
// engagement/gamification.schemas.ts, LOCK-D5), this dashboard is
// STAFF-FACING. Authorized staff (Admin/Faculty for an assigned batch)
// already have legitimate on-screen access to student names/emails elsewhere
// in the CRM, so `GamificationParticipantRowSchema` intentionally MAY carry
// `studentName`/`studentEmail` — this is a deliberate, spec-mandated
// divergence from the leaderboard's PII-minimal contract, not an oversight.
// Opted-out students (`leaderboard_opt_in=false`) ARE still included here
// (opt-out only affects the public/peer leaderboard, AC-25).
// ─────────────────────────────────────────────────────────────────────────

/** GET /api/v1/crm/reports/gamification[?batchId=] */
export const GamificationParticipationQuerySchema = z
  .object({
    /** Faculty MUST supply an assigned batchId (IDOR → 404 for unassigned); Admin/Owner may omit for the tenant-wide view. */
    batchId: UuidSchema.optional(),
  })
  .strict();
export type GamificationParticipationQuery = z.infer<typeof GamificationParticipationQuerySchema>;

/**
 * One student's participation row — STAFF-FACING (may carry name/email, AC-24).
 * Reused nowhere else; do not import this into any student-facing surface.
 */
export const GamificationParticipantRowSchema = z
  .object({
    studentId: UuidSchema,
    studentName: z.string(),
    studentEmail: z.string().email().nullable(),
    totalXp: z.number().int(),
    badgeCount: z.number().int().min(0),
  })
  .strict();
export type GamificationParticipantRow = z.infer<typeof GamificationParticipantRowSchema>;

/**
 * GET /api/v1/crm/reports/gamification response.
 * AC-23: `activeEarnersCount`, `totalXpDistributed`, `badgeAwardCount` each
 * equal a direct recomputation from `points_ledger`/`user_badges` for the
 * batch's enrolled students.
 */
export const GamificationParticipationDtoSchema = ReportFreshnessSchema.extend({
  batchId: UuidSchema.nullable(),
  activeEarnersCount: z.number().int().min(0).describe("Students with at least one non-zero points_ledger row in the window."),
  totalXpDistributed: z.number().int().describe("SUM(points_ledger.delta) for the batch's enrolled students. May be negative in aggregate only in pathological reversal-heavy cases."),
  badgeAwardCount: z.number().int().min(0),
  perStudent: z.array(GamificationParticipantRowSchema).describe("Staff-facing breakdown — includes opted-out students (AC-25)."),
}).strict();
export type GamificationParticipationDto = z.infer<typeof GamificationParticipationDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// WS-A8: Forum health dashboard — GET /api/v1/crm/reports/forum-health
// ─────────────────────────────────────────────────────────────────────────

/** GET /api/v1/crm/reports/forum-health[?batchId=] */
export const ForumHealthReportQuerySchema = z
  .object({
    batchId: UuidSchema.optional(),
  })
  .strict();
export type ForumHealthReportQuery = z.infer<typeof ForumHealthReportQuerySchema>;

/**
 * GET /api/v1/crm/reports/forum-health response.
 * AC-26: thread/post counts, `replyRate` (posts per thread), and
 * `resolutionRate` (`resolved threads / total threads`) each equal a direct
 * recomputation from `forum_threads`/`forum_posts` for the batch.
 */
export const ForumHealthReportDtoSchema = ReportFreshnessSchema.extend({
  batchId: UuidSchema.nullable(),
  threadCount: z.number().int().min(0),
  postCount: z.number().int().min(0),
  replyRate: z.number().min(0).describe("postCount / threadCount. 0 when threadCount=0 (never NaN)."),
  resolutionRate: z.number().min(0).max(1).describe("resolved threads / threadCount. 0 when threadCount=0 (never NaN)."),
}).strict();
export type ForumHealthReportDto = z.infer<typeof ForumHealthReportDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time assertions — no secrets/PII leak into the staff-facing but
// still non-owner-facing report DTOs. (Gamification participation is exempt
// from the PII-forbid list by spec design — see the note above AC-24/25 —
// so it is intentionally NOT included here.)
// ─────────────────────────────────────────────────────────────────────────

type ForbiddenReportField =
  | "apiKey"
  | "webhookSecret"
  | "signingSecret"
  | "resendApiKey"
  | "whatsappAccessToken"
  | "msgAuthKey"
  | "razorpayKeySecret"
  | "answerKey"
  | "passwordHash";

type AssertNoForbiddenFields<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "FORBIDDEN FIELD DETECTED IN REPORT DTO" : "ok",
] extends ["ok"]
  ? true
  : never;

type _AssertRevenueReportNoSecret = AssertNoForbiddenFields<RevenueReportDto, ForbiddenReportField>;
type _AssertCampaignPerformanceNoSecret = AssertNoForbiddenFields<
  CampaignPerformanceDto,
  ForbiddenReportField
>;

const _assertRevenueReport: _AssertRevenueReportNoSecret = true;
const _assertCampaignPerformance: _AssertCampaignPerformanceNoSecret = true;

export type { _AssertRevenueReportNoSecret, _AssertCampaignPerformanceNoSecret };
void _assertRevenueReport;
void _assertCampaignPerformance;
