// Students contract — Phase 1, Wave 2 (docs/plans/phase-1.md task #2).
//
// Modeling decision (plan §"Risks #1", Q1 default = "users + profile"):
// a student is a `users` row (role `student`, status `invited` until a P5
// invite/login flow lands) **plus** a 1:1 `student_profiles` row. Creating a
// student via `POST /crm/students` therefore creates BOTH rows in one
// transaction — the request body is a flat merge of user fields (name,
// email, phone) and profile fields (college, courseType, year, city, source,
// status). backend-builder: wrap user+profile insert in one DB transaction,
// write ONE audit-log row for the combined create (entity = `student`,
// entityId = the new student_profiles.id), and default the created user's
// role to `student` + status to `invited` (no password/login set here).
//
// Scope note (plan §"Risks #2"): Counsellor/BranchManager scope on students
// is enforced server-side via the ScopeInterceptor against `branch_id`
// (Counsellor scope defaults to `branch` in P1 per the plan's Q2 default —
// no `owner_id` column yet). This file does not encode scope; it only
// carries `branchId`-derivable fields the backend needs to scope against
// (via the student's batch/branch linkage once enrolled — a student with no
// enrollment yet has no resolvable branch, which is a P1 known limitation
// for lead-stage students; tracked in docs/phase-1-followups.md).

import { z } from "zod";
import { UuidSchema, PhoneSchema, IsoDateTimeSchema, BooleanQueryFlagSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { LifecycleStageSchema } from "./lifecycle.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const CourseTypeSchema = z.enum(["btech", "degree", "diploma", "mca", "mba", "other"]);
export type CourseType = z.infer<typeof CourseTypeSchema>;

export const StudentStatusSchema = z.enum(["lead", "active", "alumni"]);
export type StudentStatus = z.infer<typeof StudentStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crm/students
 * Flat merge of the new `users` row + the new `student_profiles` row (see
 * file header). `email` must be unique tenant-wide (enforced server-side).
 */
export const CreateStudentRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    phone: PhoneSchema.optional(),
    alternatePhone: PhoneSchema.optional().describe("Secondary/guardian contact number (registration step)."),
    college: z.string().min(1).max(200).optional(),
    courseType: CourseTypeSchema,
    year: z.number().int().min(1).max(8).optional(),
    city: z.string().min(1).max(120).optional(),
    source: z.string().min(1).max(120).optional(),
    status: StudentStatusSchema.default("lead"),
  })
  .strict();
export type CreateStudentRequest = z.infer<typeof CreateStudentRequestSchema>;

/**
 * PATCH /api/v1/crm/students/:id
 * Partial update of profile fields (+ optionally the linked user's name/
 * phone). Email change is intentionally NOT allowed here — that is an
 * identity change with its own verification flow, out of P1 scope.
 */
export const UpdateStudentRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: PhoneSchema,
    alternatePhone: PhoneSchema.nullable().describe("Secondary/guardian contact number; null clears it."),
    college: z.string().min(1).max(200),
    courseType: CourseTypeSchema,
    year: z.number().int().min(1).max(8),
    city: z.string().min(1).max(120),
    source: z.string().min(1).max(120),
    status: StudentStatusSchema,
  })
  .partial()
  .strict();
export type UpdateStudentRequest = z.infer<typeof UpdateStudentRequestSchema>;

/** GET /api/v1/crm/students — directory search/filter/paginate (docs/03 §7.2). */
export const ListStudentsQuerySchema = z
  .object({
    search: z.string().min(1).max(200).optional().describe("Matches name, email, or phone."),
    status: StudentStatusSchema.optional(),
    courseType: CourseTypeSchema.optional(),
    branchId: UuidSchema.optional(),
    programId: UuidSchema.optional(),
    batchId: UuidSchema.optional(),
    includeDeleted: BooleanQueryFlagSchema.default(false).describe("Admin-only: include soft-deleted rows."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListStudentsQuery = z.infer<typeof ListStudentsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

/** Row shape for the student directory table — minimal, no entity leakage. */
export const StudentSummarySchema = z.object({
  id: UuidSchema.describe("student_profiles.id — the canonical student identifier used everywhere else (enrollments.studentId, etc.)."),
  userId: UuidSchema,
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  college: z.string().nullable(),
  courseType: CourseTypeSchema,
  year: z.number().int().nullable(),
  city: z.string().nullable(),
  status: StudentStatusSchema,
  // Unified lifecycle stage (lifecycle-redesign P1) — DERIVED server-side from this
  // student's lead/enrollment/order/certificate signals via `resolveLifecycleStage`.
  // This is the single field that answers "where is this student in the journey?";
  // `status` (lead/active/alumni) remains the coarse persisted grouping.
  lifecycleStage: LifecycleStageSchema,
  createdAt: IsoDateTimeSchema,
});
export type StudentSummary = z.infer<typeof StudentSummarySchema>;

/**
 * Full profile DTO for the student detail drawer/page. Later-phase tabs
 * (payments/attendance/grades/certificates/tickets — docs/plans/phase-1.md
 * scope note) are NOT included here; the CRM renders those as empty-state
 * placeholders client-side without backing data in P1.
 */
export const StudentDetailSchema = StudentSummarySchema.extend({
  alternatePhone: z.string().nullable().describe("Secondary/guardian contact number captured at registration."),
  source: z.string().nullable(),
  deletedAt: IsoDateTimeSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type StudentDetail = z.infer<typeof StudentDetailSchema>;

/** POST /api/v1/crm/students/:id/restore — body is empty, id is in the path. */
export const RestoreStudentRequestSchema = z.object({}).strict();
export type RestoreStudentRequest = z.infer<typeof RestoreStudentRequestSchema>;

/**
 * POST /api/v1/crm/students/:id/resend-credentials — body is empty, id is in the path
 * (gap-closing pass: CRM "reissue LMS login" action). Rotates the student's LMS password
 * to a new system-generated temporary one, re-raises the must-change-password gate, and
 * re-emails the welcome message — for a lost/bounced/compromised credential. Works
 * whether the account was never provisioned, provisioned-but-unused, or already
 * onboarded (unlike the automatic on-enrollment provisioning, which only ever acts once).
 */
export const ResendCredentialsResponseSchema = z.object({
  email: z.string().email().describe("The address the reissued temporary-password email was sent to."),
});
export type ResendCredentialsResponse = z.infer<typeof ResendCredentialsResponseSchema>;
