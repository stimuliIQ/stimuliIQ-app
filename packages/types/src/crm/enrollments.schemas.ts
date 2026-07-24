// Enrollments contract — Phase 1, Wave 2 (docs/plans/phase-1.md task #2).
//
// P1 = the roster/join only (no commerce). `programId` on the enrollment
// row is denormalized from the target batch's `programId` server-side — the
// client never sends it independently of `batchId` to avoid an inconsistent
// pair (enforced by the backend, not encoded as a cross-field zod refinement
// here since `programId` is not part of the request body at all, see below).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

export const EnrollmentStatusSchema = z.enum(["active", "completed", "dropped"]);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crm/enrollments — enroll a student into a batch.
 * `programId` is derived server-side from `batchId` (see file header), so it
 * is deliberately NOT a field here. Violates the `(studentId, batchId)`
 * unique constraint -> 409.
 */
export const CreateEnrollmentRequestSchema = z
  .object({
    studentId: UuidSchema,
    batchId: UuidSchema,
    // lifecycle-redesign P4 — batch auto-spill. Default false preserves the strict
    // "batch is full → 409" behaviour for every existing caller. When true, a full
    // target batch does NOT reject: the server enrolls the student into the next
    // available batch of the SAME program+branch — an existing non-full sibling if one
    // exists, otherwise a new batch auto-created by cloning the full batch as a template
    // (capacity/mode/branch/faculty/schedule). The returned enrollment's `batchId` is the
    // batch actually used, which may differ from the requested one.
    autoSpillOnFull: z.boolean().default(false),
  })
  .strict();
export type CreateEnrollmentRequest = z.infer<typeof CreateEnrollmentRequestSchema>;

/**
 * POST /api/v1/crm/enrollments/:id/move — move a student to a different
 * batch. Implemented server-side as: validate capacity/program match
 * policy, set the existing enrollment's status based on policy, and create
 * (or reuse) the enrollment row for `toBatchId`. Contract only states intent;
 * backend-builder owns whether this is a soft-move (update batchId in place)
 * or close-old/open-new (two enrollment rows) — either way the response is
 * the resulting active EnrollmentSchema for the new batch.
 */
export const MoveEnrollmentRequestSchema = z
  .object({
    toBatchId: UuidSchema,
  })
  .strict();
export type MoveEnrollmentRequest = z.infer<typeof MoveEnrollmentRequestSchema>;

/** POST /api/v1/crm/enrollments/:id/withdraw — sets status to `dropped`. */
export const WithdrawEnrollmentRequestSchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strict();
export type WithdrawEnrollmentRequest = z.infer<typeof WithdrawEnrollmentRequestSchema>;

/** GET /api/v1/crm/enrollments — filter by student/batch/program/status. */
export const ListEnrollmentsQuerySchema = z
  .object({
    studentId: UuidSchema.optional(),
    batchId: UuidSchema.optional(),
    programId: UuidSchema.optional(),
    status: EnrollmentStatusSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListEnrollmentsQuery = z.infer<typeof ListEnrollmentsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

export const EnrollmentSchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  batchId: UuidSchema,
  batchName: z.string(),
  programId: UuidSchema,
  programTitle: z.string(),
  status: EnrollmentStatusSchema,
  progressPct: z.number().int().min(0).max(100),
  enrolledAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
});
export type Enrollment = z.infer<typeof EnrollmentSchema>;
