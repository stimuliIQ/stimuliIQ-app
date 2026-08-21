// LMS Enrollments contracts (student view) — Phase 3, Wave 2.
//
// Student-facing read-only view of the student's own enrollments.
// The student can never modify enrollment status directly — enrollment changes
// are CRM-side or commerce-side. This surface is consumption-only (scope: own).
//
// Permission: `courses.view` (scope: own). The `studentId` is resolved from
// the session; the client never sends it.
//
// The CRM surface (`packages/types/src/crm/enrollments.schemas.ts`) defines
// the staff-facing CRUD contract; this file defines the STUDENT-facing read
// contract. Shapes differ intentionally: CRM exposes staff-relevant fields;
// this exposes student-relevant learning metadata. DO NOT merge into the CRM
// schema — they serve different consumers.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Shared enrollment status (mirrors the DB enum — kept here too so
// student-surface consumers don't need to import from crm/enrollments)
// ─────────────────────────────────────────────────────────────────────────

/** Mirrors `enrollments.status` DB enum. Re-declared here so lms schemas are
 *  self-contained; stays in sync with crm/enrollments.schemas.ts by contract. */
export const MyEnrollmentStatusSchema = z.enum(["active", "completed", "dropped"]);
export type MyEnrollmentStatus = z.infer<typeof MyEnrollmentStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/me/enrollments — list the authenticated student's enrollments.
 * Offset-paginated like the CRM lists (internal, filter-heavy, stable "go to
 * page N" UX is acceptable for a small set of enrollments per student).
 */
export const ListMyEnrollmentsQuerySchema = z
  .object({
    status: MyEnrollmentStatusSchema.optional().describe("Filter by enrollment status."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListMyEnrollmentsQuery = z.infer<typeof ListMyEnrollmentsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Lightweight enrollment item for the list endpoint.
 * Contains everything needed to render a "My Courses" card without fetching
 * more detail — program title, batch, progress ring, status, dates.
 */
export const MyEnrollmentSummarySchema = z.object({
  id: UuidSchema.describe("Enrollment id."),
  programId: UuidSchema,
  programTitle: z.string(),
  programSlug: z.string(),
  programMode: z.enum(["live", "recorded", "hybrid"]),
  programImageUrl: z.string().url().nullable().describe(
    "Public CDN URL of the program's course-card image (minted server-side from " +
    "Program.ogImageKey. The raw storage key is never exposed). Null when no image " +
    "has been uploaded in the CRM. Used as the My Courses card thumbnail.",
  ),
  batchId: UuidSchema,
  batchName: z.string(),
  status: MyEnrollmentStatusSchema,
  progressPct: z.number().int().min(0).max(100),
  enrolledAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
});
export type MyEnrollmentSummary = z.infer<typeof MyEnrollmentSummarySchema>;

/**
 * Full enrollment detail — adds batch schedule dates and lesson count breakdown.
 * Returned by `GET /api/v1/me/enrollments/:id`.
 */
export const MyEnrollmentDetailSchema = MyEnrollmentSummarySchema.extend({
  programDomain: z.string(),
  programLevel: z.enum(["beginner", "intermediate", "advanced"]),
  programDurationWeeks: z.number().int().min(1),
  batchStartDate: z.string().nullable().describe("ISO-8601 date (YYYY-MM-DD) or null if not set."),
  batchEndDate: z.string().nullable(),
  lessonsTotal: z.number().int().min(0),
  lessonsCompleted: z.number().int().min(0),
  source: z.enum(["manual", "order", "conversion"]).describe(
    "How this enrollment was created. All three grant content access in P3.",
  ),
});
export type MyEnrollmentDetail = z.infer<typeof MyEnrollmentDetailSchema>;
