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

// `CourseTypeSchema` used to be `z.enum(["btech","degree","diploma","mca","mba","other"])`.
// Course types are now CRM-managed rows, so the valid set lives in the database and the API
// checks membership — see crm/course-types.schemas.ts for the full reasoning. Re-exported
// from here so existing importers of `CourseTypeSchema`/`CourseType` are unaffected.
export { CourseTypeSchema, type CourseType } from "./course-types.schemas.js";
import { CourseTypeSchema } from "./course-types.schemas.js";

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
    // The `course_types` key. Membership is checked by the API against the tenant's ACTIVE
    // options (422 `course_types.unknown`), not by this schema — the valid set is data now.
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
    courseType: CourseTypeSchema.nullable().describe("null clears it."),
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
  id: UuidSchema.describe("student_profiles.id. The canonical student identifier used everywhere else (enrollments.studentId, etc.)."),
  userId: UuidSchema,
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  college: z.string().nullable(),
  // Nullable: a website self-registration or an onboarding activation never asks for a
  // course type, and the values those paths used to write ("btech"/"other") were invented.
  courseType: CourseTypeSchema.nullable(),
  // Display label resolved server-side from `course_types` at read time, so a rename shows
  // everywhere at once. Falls back to the raw key for an option that has since been deleted,
  // and is null when `courseType` is.
  courseTypeLabel: z.string().nullable(),
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

// ─────────────────────────────────────────────────────────────────────────
// Student 360 — Attendance tab
//
// `attendance` rows have existed since P3 and are written on every lesson
// completion (source=recorded, deduped per enrollment+lesson) and by the
// live-class sync (source=live). Nothing on the STAFF side could ever read
// them: there was no CRM endpoint, no SDK method and no screen, so the
// Student 360 drawer shipped without the Attendance tab its own PRD section
// and the go-live checklist both describe. This is that read surface.
//
// Read-only by design. Editing attendance is a separate act with its own
// audit story; this answers "did they turn up", nothing more.
// ─────────────────────────────────────────────────────────────────────────

export const AttendanceStatusSchema = z.enum(["present", "absent"]);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

/** How the row was generated: joining a live class, or completing a recorded lesson. */
export const AttendanceSourceSchema = z.enum(["live", "recorded"]);
export type AttendanceSource = z.infer<typeof AttendanceSourceSchema>;

/** One attendance row, resolved to the names a staff member can read. */
export const StudentAttendanceItemSchema = z.object({
  id: UuidSchema,
  enrollmentId: UuidSchema,
  programTitle: z.string(),
  batchName: z.string().nullable().describe("Null when the enrollment is not yet in a batch."),
  /** The lesson attended. Null for a live-class row, which records a session rather than a lesson. */
  lessonTitle: z.string().nullable(),
  /** The live session attended. Null for a recorded-completion row. */
  liveClassTitle: z.string().nullable(),
  status: AttendanceStatusSchema,
  source: AttendanceSourceSchema,
  markedAt: IsoDateTimeSchema,
});
export type StudentAttendanceItem = z.infer<typeof StudentAttendanceItemSchema>;

/** GET /api/v1/crm/students/:id/attendance */
export const ListStudentAttendanceQuerySchema = z.object({}).merge(PageQuerySchema).strict();
export type ListStudentAttendanceQuery = z.infer<typeof ListStudentAttendanceQuerySchema>;
