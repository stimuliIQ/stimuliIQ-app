// Batches contract — Phase 1, Wave 2 (docs/plans/phase-1.md task #2).
//
// `branchId` is REQUIRED on batches (per db-architect's Wave-1 schema);
// `facultyId` references `faculty_profiles.id` (NOT a users.id) and is
// optional (a batch can be planned before a faculty is assigned).
// `mode` reuses the existing `ProgramMode` enum values from P0's programs
// table (`live|recorded|hybrid`) — kept as its own schema here (not imported
// from courses.schemas.ts) to avoid a cross-file coupling for a 3-value enum
// that both resources need independently.

import { z } from "zod";
import { UuidSchema, IsoDateSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const BatchModeSchema = z.enum(["live", "recorded", "hybrid"]);
export type BatchMode = z.infer<typeof BatchModeSchema>;

export const BatchStatusSchema = z.enum(["planned", "active", "completed", "archived"]);
export type BatchStatus = z.infer<typeof BatchStatusSchema>;

/**
 * Free-form weekly schedule blocks (day + start/end time). Stored as JSON;
 * validated shape here so both FE (schedule builder) and BE share one rule.
 */
export const ScheduleBlockSchema = z.object({
  day: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm (24h)"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm (24h)"),
});
export type ScheduleBlock = z.infer<typeof ScheduleBlockSchema>;

export const BatchScheduleSchema = z.array(ScheduleBlockSchema).max(14).default([]);
export type BatchSchedule = z.infer<typeof BatchScheduleSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/** POST /api/v1/crm/batches */
export const CreateBatchRequestSchema = z
  .object({
    programId: UuidSchema,
    branchId: UuidSchema,
    facultyId: UuidSchema.optional(),
    name: z.string().min(1).max(200),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema.nullable().optional(),
    capacity: z.number().int().min(1).max(10000),
    mode: BatchModeSchema,
    schedule: BatchScheduleSchema,
    status: BatchStatusSchema.default("planned"),
  })
  .strict();
export type CreateBatchRequest = z.infer<typeof CreateBatchRequestSchema>;

/** PATCH /api/v1/crm/batches/:id */
export const UpdateBatchRequestSchema = z
  .object({
    programId: UuidSchema,
    branchId: UuidSchema,
    facultyId: UuidSchema.nullable(),
    name: z.string().min(1).max(200),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema.nullable(),
    capacity: z.number().int().min(1).max(10000),
    mode: BatchModeSchema,
    schedule: BatchScheduleSchema,
    status: BatchStatusSchema,
  })
  .partial()
  .strict();
export type UpdateBatchRequest = z.infer<typeof UpdateBatchRequestSchema>;

/** GET /api/v1/crm/batches — filter by program/branch/faculty/status. */
export const ListBatchesQuerySchema = z
  .object({
    search: z.string().min(1).max(200).optional().describe("Matches batch name."),
    programId: UuidSchema.optional(),
    branchId: UuidSchema.optional(),
    facultyId: UuidSchema.optional(),
    status: BatchStatusSchema.optional(),
    includeDeleted: z.coerce.boolean().default(false),
    /**
     * Restrict to batches a student can still be put INTO: status `planned` or `active`,
     * and not past their end date.
     *
     * Enforced server-side because "don't offer a finished batch" is a correctness rule,
     * not a display preference — client-side filtering would also silently shrink a page
     * of results below its page size.
     *
     * The end-date half is not redundant with the status half. BatchAutoCloseScheduler
     * flips expired batches to `completed`, but it runs on an interval, so between the
     * end date passing and the next sweep a batch is still `active`. Checking the date
     * here makes the guarantee immediate rather than eventual.
     */
    enrollable: z.coerce.boolean().optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListBatchesQuery = z.infer<typeof ListBatchesQuerySchema>;

/** POST /api/v1/crm/batches/:id/faculty — assign (or unassign with `facultyId: null`). */
export const AssignBatchFacultyRequestSchema = z
  .object({
    facultyId: UuidSchema.nullable(),
  })
  .strict();
export type AssignBatchFacultyRequest = z.infer<typeof AssignBatchFacultyRequestSchema>;

/** POST /api/v1/crm/batches/:id/restore */
export const RestoreBatchRequestSchema = z.object({}).strict();
export type RestoreBatchRequest = z.infer<typeof RestoreBatchRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

export const BatchSummarySchema = z.object({
  id: UuidSchema,
  programId: UuidSchema,
  programTitle: z.string().describe("Denormalized for table display — avoids an N+1 program fetch."),
  branchId: UuidSchema,
  branchName: z.string(),
  facultyId: UuidSchema.nullable(),
  facultyName: z.string().nullable(),
  name: z.string(),
  startDate: IsoDateSchema,
  // `batches.end_date` is NULLABLE in the DB (Wave 1 schema — open-ended/ongoing
  // batches have no end date yet). Nullable here (not a required string) so the wire
  // contract matches the schema exactly rather than forcing a sentinel value
  // (Wave 3b resolution of the Wave-3a `endDate` gap flagged in faculty.service.ts).
  endDate: IsoDateSchema.nullable(),
  capacity: z.number().int(),
  enrolledCount: z.number().int().min(0).describe("Current active enrollment count, for capacity-vs-fill display."),
  mode: BatchModeSchema,
  status: BatchStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type BatchSummary = z.infer<typeof BatchSummarySchema>;

export const BatchDetailSchema = BatchSummarySchema.extend({
  schedule: BatchScheduleSchema,
  deletedAt: IsoDateTimeSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type BatchDetail = z.infer<typeof BatchDetailSchema>;

/**
 * GET /api/v1/crm/batches/:id/roster — the enrolled-students view for a
 * batch (docs/03 §7.5 "batch roster"). One row per active+completed
 * enrollment; dropped students are excluded by default (the `enrollments`
 * list endpoint, not this roster, is where withdrawn students remain
 * queryable for reporting).
 */
export const BatchRosterEntrySchema = z.object({
  enrollmentId: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  studentEmail: z.string().email(),
  status: z.enum(["active", "completed", "dropped"]),
  progressPct: z.number().int().min(0).max(100),
  enrolledAt: IsoDateTimeSchema,
});
export type BatchRosterEntry = z.infer<typeof BatchRosterEntrySchema>;

export const BatchRosterSchema = z.array(BatchRosterEntrySchema);
export type BatchRoster = z.infer<typeof BatchRosterSchema>;
