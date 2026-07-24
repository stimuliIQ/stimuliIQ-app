// LMS Attendance contracts (student view) — Phase 3, Wave 2.
//
// P3 scope: RECORDED attendance only.
//   - `source=recorded` is set server-side when a student completes a recorded lesson
//     (POST /me/lessons/:id/complete triggers it idempotently).
//   - Live attendance (`source=live`, `live_class_id` populated) is DEFERRED to a later
//     phase (docs/plans/phase-3.md §Risks #4). The `liveClassId` field is present in
//     the response schema (nullable) to match the DB row shape but will always be null
//     in P3 responses.
//
// STUDENT READ-ONLY:
//   The student can only READ their own attendance. There is no client-facing
//   POST/PUT for attendance — it is ALWAYS created server-side as a side-effect of:
//     1. Lesson completion (`source=recorded`, POST /me/lessons/:id/complete).
//     2. Live class join (deferred — `source=live`, not implemented in P3).
//   Permission: `attendance.view` (scope: own).
//
// ATTENDANCE INVARIANT (enforced server-side, never client-side):
//   One attendance row per (enrollment_id, lesson_id, source=recorded).
//   The complete-action is idempotent: replaying never creates a duplicate row.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums (mirror the DB enums for type-safety on the client)
// ─────────────────────────────────────────────────────────────────────────

export const AttendanceStatusSchema = z.enum(["present", "absent"]);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

export const AttendanceSourceSchema = z.enum(["live", "recorded"]);
export type AttendanceSource = z.infer<typeof AttendanceSourceSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Query (GET /api/v1/me/attendance)
// ─────────────────────────────────────────────────────────────────────────

export const ListMyAttendanceQuerySchema = z
  .object({
    enrollmentId: UuidSchema.optional().describe("Filter by a specific enrollment."),
    source: AttendanceSourceSchema.optional().describe(
      "Filter by source. In P3, only `recorded` rows exist.",
    ),
    status: AttendanceStatusSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListMyAttendanceQuery = z.infer<typeof ListMyAttendanceQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTO
// ─────────────────────────────────────────────────────────────────────────

/**
 * A single attendance record from the student's perspective.
 *
 * `lessonId` is populated for recorded attendance; null for live class attendance
 * (deferred — will not appear in P3 responses). `liveClassId` is the inverse.
 *
 * The frontend attendance view shows this list grouped by program/module to
 * give the student a view of their completion/attendance % per course
 * (docs/02 §7.7).
 */
export const MyAttendanceItemSchema = z.object({
  id: UuidSchema.describe("Attendance row id."),
  enrollmentId: UuidSchema,
  programId: UuidSchema.describe("Denormalized from enrollment for grouping in the UI."),
  programTitle: z.string(),
  lessonId: UuidSchema.nullable().describe(
    "The recorded lesson this row covers. Always populated in P3. " +
    "Null for live-class rows (deferred — not present in P3 responses).",
  ),
  lessonTitle: z.string().nullable().describe(
    "Denormalized lesson title. Null if lessonId is null.",
  ),
  liveClassId: UuidSchema.nullable().describe(
    "The live_class id this row covers. Always null in P3 (live attendance deferred). " +
    "Will be populated in a future phase when LiveClassProvider is implemented.",
  ),
  status: AttendanceStatusSchema.describe(
    "present = lesson completed or live class joined; absent = missed. " +
    "In P3 recorded completion always creates status=present.",
  ),
  source: AttendanceSourceSchema.describe(
    "recorded = triggered by recorded lesson completion. " +
    "live = triggered by live class join (deferred, not in P3).",
  ),
  markedAt: IsoDateTimeSchema.describe("When this attendance row was created/marked."),
});
export type MyAttendanceItem = z.infer<typeof MyAttendanceItemSchema>;

/**
 * GET /api/v1/me/attendance → data field (array) with offset-pagination meta.
 *
 * Returned as a paginated list. The meta carries OffsetPaginationMeta
 * (page/pageSize/total/hasMore) so the student can page through their history.
 *
 * Additionally, the API returns per-enrollment attendance summary stats
 * in the `summary` field so the student can see their attendance % without
 * scanning every page.
 */
export const AttendanceSummarySchema = z.object({
  enrollmentId: UuidSchema,
  programTitle: z.string(),
  totalRecorded: z.number().int().min(0).describe("Total recorded attendance rows (= completed lessons)."),
  totalLessons: z.number().int().min(0).describe("Total lessons in the program (denominator for %)."),
  attendancePct: z.number().int().min(0).max(100).describe(
    "totalRecorded / totalLessons × 100. Rounded to nearest integer.",
  ),
});
export type AttendanceSummary = z.infer<typeof AttendanceSummarySchema>;

/**
 * Full attendance response: paginated list + per-enrollment summaries.
 * Returned as `data` in the standard `{ data, meta, error }` envelope,
 * where `meta` carries OffsetPaginationMeta (via requestPaginated).
 */
export const MyAttendanceResponseSchema = z.object({
  items: z.array(MyAttendanceItemSchema),
  summaries: z.array(AttendanceSummarySchema).describe(
    "Per-enrollment attendance summaries for quick % display. " +
    "Covers all active enrollments regardless of the current page filter.",
  ),
});
export type MyAttendanceResponse = z.infer<typeof MyAttendanceResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CRM attendance editor (PATCH /api/v1/crm/attendance) — Phase-9-completion gap #6.
//
// Closes the "attendance is read-only" gap flagged in apps/crm/src/components/
// attendance/batch-attendance-roster.tsx: staff (faculty for their assigned batches;
// admin/super_admin for any batch) can set/correct a student's attendance for a
// (enrollment, lesson) pair. Writes to the SAME dedup key as the student
// self-service completion path (enrollment_id, lesson_id, source='recorded') — a
// staff correction supersedes, never duplicates, the auto-recorded row. AUDITED
// (Attendance is in AUDITED_MODELS — every create/update writes an audit_logs row).
// ─────────────────────────────────────────────────────────────────────────

export const SetAttendanceRequestSchema = z
  .object({
    enrollmentId: UuidSchema,
    lessonId: UuidSchema,
    status: AttendanceStatusSchema,
  })
  .strict();
export type SetAttendanceRequest = z.infer<typeof SetAttendanceRequestSchema>;

export const AttendanceRecordSchema = z.object({
  id: UuidSchema,
  enrollmentId: UuidSchema,
  lessonId: UuidSchema.nullable(),
  status: AttendanceStatusSchema,
  source: AttendanceSourceSchema,
  markedAt: IsoDateTimeSchema,
});
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;
