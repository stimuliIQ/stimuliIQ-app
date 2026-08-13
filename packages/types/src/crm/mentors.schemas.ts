// Mentor contract — Phase 8, human-mentor track (docs/specs/phase-8-mentor.md).
// api-designer task #2. Consumed by backend-builder (Wave-2 MentorsController +
// completion-rollup service) and frontend-builder (CRM mentor directory + the
// mentor-facing dashboard route).
//
// IMPORTANT — a Mentor here is a REAL, HUMAN subject-matter expert hired from an
// EXTERNAL institute (distinct from `FacultyProfile`, an internal hire). This file
// has nothing to do with the AI doubt-solving chatbot (`docs/specs/phase-8-ai-mentor.md`,
// LOCK-6) — no LLM/chat shape lives here.
//
// ── GROUND-TRUTH SCHEMA NOTE (read before touching this file) ──────────────────────
// This contract is written against the ACTUAL shipped Prisma schema/migrations
// (`prisma/schema.prisma` `model Mentor`/`model BatchMentor`, migrations
// `20260708080000_mentors_core` + `..._partial_indexes`), not the spec's Part 7
// prose verbatim — db-architect's Wave-1 implementation deliberately diverges from
// the spec text in three ways, each documented in the schema itself:
//   1. `mentors.user_id` is NULLABLE (unlike `faculty_profiles.user_id`, which is
//      required). A mentor hiring record can exist for a long time before a
//      dashboard login is ever granted. Consequently `POST /crm/mentors` in THIS
//      contract creates ONLY a `mentors` row — it does NOT create a `users` row the
//      way `POST /crm/students`/`POST /crm/faculty` do. There is currently NO
//      endpoint in this contract (or in the task brief's endpoint list) that grants
//      a mentor a login — `userId` is server/seed-controlled and always `null` on
//      create. Flagged as an open follow-up for a future task (`docs/phase-8-followups.md`).
//   2. `mentors` has NO `branch_id` column at all — spec AC-4/AC-5/the Part-4 edge
//      case describe branch-scoped mentor hiring records, but the shipped schema
//      cannot support that filter today. `ListMentorsQuerySchema` therefore has no
//      `branchId` filter, and `CreateMentorRequestSchema` has no `branchId` field.
//      Branch Manager's mentor-directory scope (per the RBAC seed, `mentors.*`
//      granted at `RolePermissionScope.branch`) currently has no column to scope
//      against — flagged as a blocking gap for backend-builder/security-reviewer;
//      resolving it needs a follow-up migration (db-architect) adding
//      `mentors.branch_id`, out of this task's scope.
//   3. `mentors.email` is `NOT NULL` (no `?`) — stricter than AC-2's literal "at
//      least one of email/phone" wording. `CreateMentorRequestSchema.email` is
//      therefore REQUIRED (matching the DB), which makes AC-2's "both email AND
//      phone missing" scenario unreachable by construction — the weaker "at least
//      one contact method" intent is trivially satisfied since email always exists.
//
// ── BUSINESS-RULE VALIDATION NOTE (mirrors reports.schemas.ts precedent) ───────────
// Every error code below that the spec pins to 422/409 is a BUSINESS RULE, not a
// zod shape check, and is deliberately NOT encoded as a `.refine()` here: the global
// `ZodValidationPipe` maps a zod shape failure to 400 (see
// apps/api/src/common/pipes/zod-validation.pipe.ts), but these codes require a
// specific status the pipe does not produce. backend-builder's service layer owns:
//   - 422 `JOINED_DATE_REQUIRED`      — engagementStatus='active' with no joinedAt (AC-3).
//   - 422 `MENTOR_NOT_ACTIVE`         — assigning a prospective/inactive mentor (AC-18).
//   - 409 `ALREADY_ASSIGNED`          — duplicate active (mentorId,batchId) assignment (AC-19).
//   - 422 `BATCH_NOT_ASSIGNABLE`      — assign/lead-change on a completed/archived batch (AC-26).
//   - 409 `MENTOR_HAS_ACTIVE_ASSIGNMENTS` — soft-delete blocked while assigned (AC-12).
//     Surfaced via `ProblemDetails.errors: [{ path: "batchMentorId", message: "<batchName>" }, ...]`
//     — one entry per still-active assignment (the envelope has no other structured-list slot).
//   - 422 `BATCH_NOT_ACTIVE`          — mark-complete attempted on a non-active batch (AC-39).
//   - 409 `ALREADY_COMPLETED`         — mark-complete replay on an already-completed/archived batch (AC-39).
//
// ── PERMISSIONS NOTE (Rule M-3, docs/specs/phase-8-mentor.md Part 7) ────────────────
// mentors.view/create/edit/delete/assign — Admin/Owner (all), Branch Manager (branch).
// NEVER granted to the Mentor role (Rule M-3, AC-54).
// mentor.dashboard.view                  — Mentor role ONLY, scope=own.
// batches.view (existing permission)     — gains a new scope RESOLVER for Mentor:
//   `assigned` via `batch_mentors.mentor_id` (LOCK-2/Rule M-1), not `batches.faculty_id`.
//   Reused (not a new permission) for GET .../mentors, GET .../completion, GET .../completion/students.
// batches.markComplete (NEW permission) — Admin/Owner (all), Branch Manager (branch),
//   Mentor (assigned — every actively-assigned mentor, lead or not, AC-38).
//
// FLAGGED GAP FOR db-architect/backend-builder: as of this task, the seed catalog
// (`prisma/seed.ts` `P8_PERMISSIONS`) does NOT yet contain `batches.markComplete`,
// and the Mentor role is NOT yet granted `batches.view` (assigned) or
// `batches.markComplete` (assigned) — only `mentor.dashboard.view` is granted today.
// The `@RequirePermission("batches.markComplete")` guard this contract specifies
// will 403 every caller, including Admin/Owner, until that permission is added to
// the catalog and granted per the RBAC table above. This is a blocking dependency,
// not an error in this contract.

import { z } from "zod";
import { UuidSchema, PhoneSchema, IsoDateSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { BatchStatusSchema } from "./batches.schemas.js";
import { EnrollmentStatusSchema } from "./enrollments.schemas.js";
import { EligibilityResultSchema, CertificateStatusSchema } from "../learning/certificates.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

/** Matches Prisma `MentorEngagementStatus`. Distinct from soft-delete (AC-10). */
export const MentorEngagementStatusSchema = z.enum(["prospective", "active", "inactive"]);
export type MentorEngagementStatus = z.infer<typeof MentorEngagementStatusSchema>;

/**
 * Public social links shown on a mentor's marketing card (web /mentors page).
 * All optional URLs; stored as the `mentors.social_links` JSON column. Mirrors
 * FacultyBioSocialLinksSchema, adding `github` (mentors are technical experts).
 */
export const MentorSocialLinksSchema = z
  .object({
    linkedin: z.string().url().max(500).optional(),
    twitter: z.string().url().max(500).optional(),
    github: z.string().url().max(500).optional(),
    website: z.string().url().max(500).optional(),
  })
  .strict();
export type MentorSocialLinks = z.infer<typeof MentorSocialLinksSchema>;

/**
 * Server-computed classification bucket for a per-student completion row —
 * the SAME buckets the batch-level rollup counts (AC-34). The client MUST
 * NEVER re-derive this client-side (single source of truth, AC-31).
 */
export const BatchCompletionBucketSchema = z.enum([
  "certified",
  "eligibleNotIssued",
  "inProgress",
  "dropped",
]);
export type BatchCompletionBucket = z.infer<typeof BatchCompletionBucketSchema>;

// ═════════════════════════════════════════════════════════════════════════
// WS-1: Mentor records + hiring — /api/v1/crm/mentors
// ═════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/crm/mentors
 * Creates ONLY a `mentors` row (see file header note #1 — no `users` row, no
 * login is created here). `email` is required (matches the DB NOT NULL
 * column); `phone` is optional. `engagementStatus` defaults to `prospective`
 * (matches the DB default). Setting `engagementStatus: 'active'` without
 * `joinedAt` is a 422 `JOINED_DATE_REQUIRED` business rule (AC-3), enforced
 * server-side — not a zod shape check (see file header).
 */
export const CreateMentorRequestSchema = z
  .object({
    fullName: z.string().min(1).max(200),
    email: z.string().email().max(254),
    phone: PhoneSchema.optional(),
    externalInstitute: z.string().min(1).max(200),
    expertise: z.array(z.string().min(1).max(80)).max(20).default([]),
    engagementStatus: MentorEngagementStatusSchema.default("prospective"),
    joinedAt: IsoDateSchema.optional().describe(
      "Required (service-layer 422 JOINED_DATE_REQUIRED) when engagementStatus='active' (AC-3).",
    ),
    notes: z.string().max(2000).optional(),
    // ── Public marketing-profile fields (bound to the web /mentors page) ──
    photoKey: z.string().min(1).max(1024).optional().describe(
      "S3/R2 object key from POST /crm/mentors/photo-upload-url. The API mints a public CDN " +
        "photoUrl from it — the raw key is never returned.",
    ),
    title: z.string().max(160).optional().describe("Professional headline, e.g. 'Senior ML Engineer, Microsoft'."),
    bio: z.string().max(4000).optional().describe("Paragraph-length professional biography (public)."),
    yearsExperience: z.number().int().min(0).max(70).optional(),
    socialLinks: MentorSocialLinksSchema.optional(),
  })
  .strict();
export type CreateMentorRequest = z.infer<typeof CreateMentorRequestSchema>;

/** PATCH /api/v1/crm/mentors/:id — partial update (AC-9). Same JOINED_DATE_REQUIRED rule applies. */
export const UpdateMentorRequestSchema = z
  .object({
    fullName: z.string().min(1).max(200),
    email: z.string().email().max(254),
    phone: PhoneSchema.nullable(),
    externalInstitute: z.string().min(1).max(200),
    expertise: z.array(z.string().min(1).max(80)).max(20),
    engagementStatus: MentorEngagementStatusSchema,
    joinedAt: IsoDateSchema.nullable(),
    notes: z.string().max(2000).nullable(),
    photoKey: z.string().min(1).max(1024).nullable().describe("Set to a new key to replace the photo, or null to clear it."),
    title: z.string().max(160).nullable(),
    bio: z.string().max(4000).nullable(),
    yearsExperience: z.number().int().min(0).max(70).nullable(),
    socialLinks: MentorSocialLinksSchema.nullable(),
  })
  .partial()
  .strict();
export type UpdateMentorRequest = z.infer<typeof UpdateMentorRequestSchema>;

/** GET /api/v1/crm/mentors — directory search/filter/paginate (AC-5/6/7/8). */
export const ListMentorsQuerySchema = z
  .object({
    search: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Matches fullName or externalInstitute, case-insensitive (AC-6). Empty/whitespace treated as no filter (Part 4 edge case)."),
    engagementStatus: MentorEngagementStatusSchema.optional(),
    expertise: z.string().min(1).max(80).optional().describe("Matches one entry in the expertise array (AC-7)."),
    includeDeleted: z.coerce.boolean().default(false).describe("Admin-only: include soft-deleted rows."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListMentorsQuery = z.infer<typeof ListMentorsQuerySchema>;

/** A mentor's currently-active batch assignment, for `MentorDetail.assignedBatches`. */
export const MentorAssignedBatchSchema = z.object({
  batchMentorId: UuidSchema,
  batchId: UuidSchema,
  batchName: z.string(),
  programTitle: z.string(),
  status: BatchStatusSchema,
  isLead: z.boolean(),
  assignedAt: IsoDateTimeSchema,
});
export type MentorAssignedBatch = z.infer<typeof MentorAssignedBatchSchema>;

/** Row shape for the mentor directory table — minimal, no entity leakage. */
export const MentorSummarySchema = z.object({
  id: UuidSchema,
  userId: UuidSchema.nullable().describe(
    "Set only once a dashboard login is granted. Nullable by design (see file header note #1) — " +
      "no endpoint in this contract sets this field.",
  ),
  fullName: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  externalInstitute: z.string(),
  expertise: z.array(z.string()),
  engagementStatus: MentorEngagementStatusSchema,
  joinedAt: IsoDateSchema.nullable(),
  assignedBatchCount: z.number().int().min(0).describe("Count of ACTIVE (non-removed) batch_mentors rows for this mentor."),
  // Public marketing-profile fields shown in the directory row (photo thumbnail + headline).
  photoUrl: z.string().url().nullable().describe("Public CDN URL minted from photo_key; null if no photo."),
  title: z.string().nullable(),
  yearsExperience: z.number().int().min(0).nullable(),
  createdAt: IsoDateTimeSchema,
});
export type MentorSummary = z.infer<typeof MentorSummarySchema>;

/** Full profile DTO for the mentor detail drawer/page. */
export const MentorDetailSchema = MentorSummarySchema.extend({
  notes: z.string().nullable(),
  bio: z.string().nullable(),
  socialLinks: MentorSocialLinksSchema.nullable(),
  deletedAt: IsoDateTimeSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
  assignedBatches: z
    .array(MentorAssignedBatchSchema)
    .describe("Currently-ACTIVE assignments only. Removed/historical rows are preserved server-side (AC-10, Rule M-5) but not surfaced here."),
});
export type MentorDetail = z.infer<typeof MentorDetailSchema>;

/** POST /api/v1/crm/mentors/:id/restore — body is empty, id is in the path. */
export const RestoreMentorRequestSchema = z.object({}).strict();
export type RestoreMentorRequest = z.infer<typeof RestoreMentorRequestSchema>;

/**
 * POST /api/v1/crm/mentors/photo-upload-url — mint a short-lived signed PUT URL for a
 * mentor photo (staff-scoped; permission `mentors.edit`). The client PUTs the image
 * directly to the returned URL, then sends the returned `storageKey` back as
 * `photoKey` on create/update. Response is the shared `SignedUploadResponse`.
 */
export const MentorPhotoUploadUrlRequestSchema = z
  .object({
    contentType: z
      .enum(["image/jpeg", "image/png", "image/webp"])
      .describe("Mentor photos are images only — the signed URL enforces this content-type."),
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1).max(5_242_880).describe("Max 5 MB per mentor photo."),
  })
  .strict();
export type MentorPhotoUploadUrlRequest = z.infer<typeof MentorPhotoUploadUrlRequestSchema>;

// ═════════════════════════════════════════════════════════════════════════
// WS-2: Assign mentors to batches — /api/v1/crm/batches/:id/mentors
// ═════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/crm/batches/:id/mentors
 *
 * Semantics (backend-builder, since this is a business rule not a zod shape check):
 *   - mentorId NOT currently actively assigned to this batch → creates a new active
 *     `batch_mentors` row (AC-20, many concurrent mentors allowed). If `isLead:true`,
 *     any other mentor's lead flag on this batch is cleared first (AC-21).
 *   - mentorId ALREADY actively assigned, requested `isLead` differs from the
 *     current stored value → UPDATES the existing row's `isLead` in place (this is
 *     how AC-21's lead-reassignment is reached through this single endpoint, no
 *     separate lead-designation endpoint exists). If becoming lead, clears any other
 *     mentor's lead flag on this batch first.
 *   - mentorId ALREADY actively assigned, requested `isLead` EQUALS the current
 *     stored value (a literal repeat) → 409 `ALREADY_ASSIGNED` (AC-19).
 *   - mentor is `prospective`/`inactive` → 422 `MENTOR_NOT_ACTIVE` (AC-18).
 *   - batch `status` is `completed`/`archived` → 422 `BATCH_NOT_ASSIGNABLE` (AC-26).
 */
export const AssignMentorToBatchRequestSchema = z
  .object({
    mentorId: UuidSchema,
    isLead: z.boolean().default(false),
  })
  .strict();
export type AssignMentorToBatchRequest = z.infer<typeof AssignMentorToBatchRequestSchema>;

/** One row of a batch's mentor list — GET/POST /api/v1/crm/batches/:id/mentors. */
export const MentorBatchAssignmentSchema = z.object({
  batchMentorId: UuidSchema,
  mentorId: UuidSchema,
  mentorFullName: z.string(),
  mentorEmail: z.string().email(),
  mentorExternalInstitute: z.string(),
  mentorEngagementStatus: MentorEngagementStatusSchema,
  isLead: z.boolean(),
  assignedAt: IsoDateTimeSchema,
});
export type MentorBatchAssignment = z.infer<typeof MentorBatchAssignmentSchema>;

/** GET /api/v1/crm/batches/:id/mentors response — a batch may have zero mentors (AC-25). */
export const MentorBatchAssignmentListSchema = z.array(MentorBatchAssignmentSchema);
export type MentorBatchAssignmentList = z.infer<typeof MentorBatchAssignmentListSchema>;

// ═════════════════════════════════════════════════════════════════════════
// WS-3: Track internship program to completion — /api/v1/crm/batches/:id/completion(+/students)
// and /api/v1/crm/batches/:id/complete
// ═════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/crm/batches/:id/completion response — BATCH-LEVEL only (no
 * embedded per-student array; see `BatchCompletionStudentRowSchema` +
 * `GET .../completion/students` below for the paginated per-student
 * breakdown, per the Part-4 edge case: "500+ students → server-side
 * pagination applies to any per-student breakdown list, never an unbounded
 * array in one response").
 *
 * LOCK-4/AC-31: every number here is a LIVE read of `enrollments`,
 * `lesson_progress`, `submissions`, `attempts`, `assessments`, `assignments`,
 * `certificates` (or the P4 eligibility engine composed over them) — never a
 * cached/materialized/parallel progress table. Unlike the WS-A KPI dashboards
 * (`crm/reports.schemas.ts`, MV-backed with `ReportFreshnessSchema`), this
 * rollup has no "stale" concept — it is always computed fresh per request.
 */
export const BatchCompletionSummaryDtoSchema = z.object({
  batchId: UuidSchema,
  batchName: z.string(),
  status: BatchStatusSchema,
  completedAt: IsoDateTimeSchema.nullable(),

  // ── AC-34 headcount buckets — each MUST equal a direct recomputation ──
  totalActive: z.number().int().min(0).describe(
    "COUNT(enrollments) WHERE batch_id=B AND status IN ('active','completed') — all non-dropped enrollments.",
  ),
  certified: z.number().int().min(0).describe("COUNT(enrollments) WHERE batch_id=B AND has a certificate with status='valid'."),
  eligibleNotIssued: z.number().int().min(0).describe(
    "COUNT(enrollments) WHERE batch_id=B, P4 eligibility.eligible=true, AND no valid certificate exists yet.",
  ),
  inProgress: z.number().int().min(0).describe(
    "COUNT(enrollments) WHERE batch_id=B, status != 'dropped', eligibility.eligible=false, AND no valid certificate.",
  ),
  dropped: z.number().int().min(0).describe("COUNT(enrollments) WHERE batch_id=B AND status='dropped'."),

  // ── AC-35 single source of truth for "% complete" (CRM + mentor dashboard both reference this exact value) ──
  percentComplete: z.number().min(0).max(100).nullable().describe(
    "Average of enrollments.progress_pct (which IS lesson-completion %, see lms/progress.schemas.ts) " +
      "across ACTIVE (non-dropped) enrollments only. `null` when totalActive=0 (AC-36 — a zero-enrollment " +
      "batch is a valid 200, never 404/500; `null` distinguishes 'no data' from a literal 0%).",
  ),

  // ── Supplementary batch-wide aggregates (additive to the AC-31-36 core above; computed LIVE
  //    from the same tables per LOCK-4, never a second progress-computation system) ──
  assignmentsSubmittedPct: z.number().min(0).max(100).nullable().describe(
    "% of (activeEnrollmentCount × program's non-project assignment count) that has a submission. " +
      "Null when totalActive=0.",
  ),
  assessmentsPassedPct: z.number().min(0).max(100).nullable().describe(
    "% of active enrollments where eligibility.reasons.requiredAssessmentsPassed=true. Null when totalActive=0.",
  ),
  finalProjectApprovedPct: z.number().min(0).max(100).nullable().describe(
    "% of active enrollments where eligibility.reasons.finalProjectApproved=true. Null when totalActive=0.",
  ),

  canTransitionToComplete: z.boolean().describe(
    "true iff status === 'active' (AC-39) — a UI convenience flag ONLY. Rule M-2/AC-41: the mark-complete " +
      "action is NEVER gated by completion numbers above, regardless of this flag's sibling fields.",
  ),
});
export type BatchCompletionSummaryDto = z.infer<typeof BatchCompletionSummaryDtoSchema>;

/**
 * One row of the paginated per-student breakdown — GET .../completion/students.
 * `eligibility` reuses `EligibilityResultSchema` VERBATIM (AC-33) — its
 * `reasons.completionPct` IS the exact `enrollments.progress_pct` value
 * (AC-32), so no separate progress field is duplicated here.
 */
export const BatchCompletionStudentRowSchema = z.object({
  enrollmentId: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  status: EnrollmentStatusSchema,
  bucket: BatchCompletionBucketSchema.describe("Server-computed — matches the AC-34 headcount buckets exactly. Never re-derive client-side."),
  eligibility: EligibilityResultSchema,
  certificateStatus: CertificateStatusSchema.nullable(),
  certificateId: UuidSchema.nullable(),
});
export type BatchCompletionStudentRow = z.infer<typeof BatchCompletionStudentRowSchema>;

/** GET /api/v1/crm/batches/:id/completion/students */
export const ListBatchCompletionStudentsQuerySchema = z
  .object({
    bucket: BatchCompletionBucketSchema.optional(),
    status: EnrollmentStatusSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListBatchCompletionStudentsQuery = z.infer<typeof ListBatchCompletionStudentsQuerySchema>;

/**
 * POST /api/v1/crm/batches/:id/complete — empty confirmation body (the batch
 * is identified by the path param). Idempotency-Key header required.
 * Valid ONLY from status='active' (422 `BATCH_NOT_ACTIVE` from 'planned';
 * 409 `ALREADY_COMPLETED` — idempotent no-op — from 'completed'/'archived', AC-39).
 */
export const MarkBatchCompleteRequestSchema = z.object({}).strict();
export type MarkBatchCompleteRequest = z.infer<typeof MarkBatchCompleteRequestSchema>;

/**
 * Response includes the rollup AT THE MOMENT OF TRANSITION (AC-41 — shown for
 * visibility, never a gate) alongside the new status/completedAt.
 *
 * AC-42 originally read "marking complete NEVER mutates enrollment/progress/grading/
 * certificate data — a pure status/completed_at write". The certificate half of that no
 * longer holds: completing a batch is the staff assertion that this cohort finished its
 * training, and it now issues each student's TRAINING certificate. Enrollment, progress and
 * grading rows are still never touched. The `certificates` counts below report what the
 * issuance pass did so the outcome is visible instead of assumed.
 */
export const MarkBatchCompleteResponseSchema = z.object({
  batchId: UuidSchema,
  status: BatchStatusSchema,
  completedAt: IsoDateTimeSchema,
  completedByUserId: UuidSchema,
  summary: BatchCompletionSummaryDtoSchema,
  certificates: z
    .object({
      issued: z.number().int().min(0).describe("Training certificates minted by this transition."),
      skipped: z
        .number()
        .int()
        .min(0)
        .describe("Enrollments passed over — already certified, or withdrawn from the batch."),
      failed: z
        .number()
        .int()
        .min(0)
        .describe("Enrollments that errored during issuance; retry from the certificate directory."),
    })
    .describe("Outcome of the automatic training-certificate issuance triggered by completion."),
});
export type MarkBatchCompleteResponse = z.infer<typeof MarkBatchCompleteResponseSchema>;

// ═════════════════════════════════════════════════════════════════════════
// WS-4: Mentor-facing dashboard — GET /api/v1/me/mentor/dashboard
// ═════════════════════════════════════════════════════════════════════════

/**
 * One batch summary card on the mentor's own dashboard (AC-50). Deliberately
 * MINIMAL — no per-student data here (drill into a specific batch via
 * `GET /crm/batches/:id/completion(+/students)`, scope-gated identically for
 * a Mentor per LOCK-2/Rule M-1 — AC-52: the mentor's drill-in view is
 * IDENTICAL in shape/values to what CRM staff see, not a lite/parallel copy).
 */
export const MentorDashboardBatchCardSchema = z.object({
  batchId: UuidSchema,
  batchName: z.string(),
  programTitle: z.string(),
  status: BatchStatusSchema,
  isLead: z.boolean(),
  studentCount: z.number().int().min(0).describe("Equals BatchCompletionSummaryDto.totalActive for this batch (AC-50)."),
  percentComplete: z.number().min(0).max(100).nullable().describe(
    "The EXACT AC-35 value for this batch — sourced from the SAME rollup function CRM staff use, never a " +
      "separately-maintained mentor-only calculation (AC-50).",
  ),
});
export type MentorDashboardBatchCard = z.infer<typeof MentorDashboardBatchCardSchema>;

/**
 * GET /api/v1/me/mentor/dashboard response.
 *
 * SCOPE (server-enforced, fail-closed — LOCK-2/Rule M-1/Rule M-4, CLAUDE.md §3.5):
 * carries NO tenant/branch/mentor selector — the caller's own `mentorProfile` and
 * its ACTIVE `batch_mentors` rows are resolved entirely server-side from the
 * session on every request (never cached from login time, AC-49). A Mentor with no
 * `mentorProfile`, or whose `engagementStatus` has left `active`, gets 403 on this
 * endpoint (Rule M-4) rather than an empty-but-200 response. A Mentor account that
 * IS valid but has zero batch_mentors rows gets a 200 with `batches: []` (AC-51 —
 * a valid empty state, not an error).
 */
export const MentorDashboardDtoSchema = z.object({
  mentorId: UuidSchema,
  mentorFullName: z.string(),
  batches: z
    .array(MentorDashboardBatchCardSchema)
    .describe("ONLY the caller's own actively-assigned batches (AC-46/47/48). Empty array is valid (AC-51)."),
});
export type MentorDashboardDto = z.infer<typeof MentorDashboardDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time assertions — mirrors reports.schemas.ts's
// `AssertNoForbiddenFields` pattern. The mentor-scoped dashboard surface may
// NEVER carry a tenant/branch selector, another mentor's identifiers, raw
// student contact PII, or any secret/commerce field (AC-46-48, AC-55, AC-56,
// Rule M-3) — asserted here so a future field addition that violates the
// scope boundary fails the @repo/types build, not code review.
// ─────────────────────────────────────────────────────────────────────────

type ForbiddenMentorScopedField =
  | "tenantId"
  | "branchId"
  | "otherMentorId"
  | "assignedByUserId"
  | "studentEmail"
  | "studentPhone"
  | "paymentAmountPaise"
  | "invoiceId"
  | "kycDocumentUrl"
  | "passwordHash"
  | "answerKey";

type AssertNoForbiddenFields<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "FORBIDDEN FIELD DETECTED IN MENTOR-SCOPED DTO" : "ok",
] extends ["ok"]
  ? true
  : never;

type _AssertMentorDashboardDtoNoLeak = AssertNoForbiddenFields<MentorDashboardDto, ForbiddenMentorScopedField>;
type _AssertMentorDashboardBatchCardNoLeak = AssertNoForbiddenFields<
  MentorDashboardBatchCard,
  ForbiddenMentorScopedField
>;
type _AssertBatchCompletionSummaryNoLeak = AssertNoForbiddenFields<
  BatchCompletionSummaryDto,
  ForbiddenMentorScopedField
>;
type _AssertBatchCompletionStudentRowNoLeak = AssertNoForbiddenFields<
  BatchCompletionStudentRow,
  ForbiddenMentorScopedField
>;

const _assertMentorDashboardDto: _AssertMentorDashboardDtoNoLeak = true;
const _assertMentorDashboardBatchCard: _AssertMentorDashboardBatchCardNoLeak = true;
const _assertBatchCompletionSummary: _AssertBatchCompletionSummaryNoLeak = true;
const _assertBatchCompletionStudentRow: _AssertBatchCompletionStudentRowNoLeak = true;

export type {
  _AssertMentorDashboardDtoNoLeak,
  _AssertMentorDashboardBatchCardNoLeak,
  _AssertBatchCompletionSummaryNoLeak,
  _AssertBatchCompletionStudentRowNoLeak,
};
void _assertMentorDashboardDto;
void _assertMentorDashboardBatchCard;
void _assertBatchCompletionSummary;
void _assertBatchCompletionStudentRow;
