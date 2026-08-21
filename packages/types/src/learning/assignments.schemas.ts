// Assignment + Project + Submission contracts — Phase 4, Wave 2
// (docs/plans/phase-4.md task #2, docs/specs/phase-4-learning-depth.md).
//
// Modeling decisions:
//   - Projects are assignments with kind='project' + milestone rows (docs/plans/phase-4.md
//     §7 Q7). No separate top-level project resource.
//   - Files in submissions are StorageProvider keys (server-side refs), NEVER raw URLs.
//     Clients obtain signed download URLs via GET /submissions/:id/download-url.
//   - Derived status for student view: 'assigned'|'submitted'|'graded'|'overdue'.
//     The backend computes this from submission state + due_at on read.
//   - Rubric is an open JSON structure (faculty-authored via RubricGrader component).
//     Typed as z.record(z.string(), z.unknown()) to accept any valid JSON object.
//   - Grade changes are audited with before/after; the schema expresses the wire DTO,
//     not the audit payload (audit is a backend concern).
//   - Idempotency-Key header is required on all unsafe mutations (docs/04 §2.14).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const AssignmentKindSchema = z.enum(["assignment", "project"]);
export type AssignmentKind = z.infer<typeof AssignmentKindSchema>;

export const SubmissionStatusSchema = z.enum(["submitted", "graded", "returned"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

/**
 * Derived student-facing status for an assignment list item.
 * Computed server-side from submission state + due_at, NOT stored in DB.
 */
/**
 * What the STUDENT sees on an assignment.
 *
 * `returned` = a reviewer sent the work back for changes. It is deliberately its own state
 * rather than being folded into `submitted`: before it existed, a returned submission
 * derived to "Submitted", so the student sat waiting for a verdict that had already been
 * delivered and never saw the resubmit form. It is not a fail — a fail is a low `graded`
 * score. It means "do this again", and it is the only student-facing state that asks for
 * an action after handing work in.
 */
export const AssignmentStudentStatusSchema = z.enum([
  "assigned",
  "submitted",
  "returned",
  "graded",
  "overdue",
]);
export type AssignmentStudentStatus = z.infer<typeof AssignmentStudentStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Shared sub-schemas
// ─────────────────────────────────────────────────────────────────────────

/**
 * A milestone within a project assignment.
 * Only present on assignments with kind='project'.
 */
export const MilestoneSchema = z.object({
  id: UuidSchema,
  title: z.string().min(1).max(200),
  order: z.number().int().min(0),
  dueAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Milestone = z.infer<typeof MilestoneSchema>;

/**
 * Input DTO for creating/updating a milestone (nested in assignment author flow).
 */
export const MilestoneInputSchema = z.object({
  title: z.string().min(1).max(200),
  order: z.number().int().min(0),
  dueAt: IsoDateTimeSchema.optional(),
});
export type MilestoneInput = z.infer<typeof MilestoneInputSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Author DTOs (CRM / faculty, assigned-scope)
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crm/assignments
 *
 * Faculty authors an assignment (or project) on a lesson within their assigned batch.
 * `milestones` is only meaningful when `kind='project'`.
 * `isFinal` is only meaningful when `kind='project'`; marks the certificate-gate project.
 * `maxScore` is in integer points (not paise — it is a grade, not money).
 *
 * Permission: assignments.create (scope: assigned — lesson must be in an assigned batch).
 */
export const CreateAssignmentRequestSchema = z
  .object({
    lessonId: UuidSchema.describe("The lesson this assignment is attached to."),
    kind: AssignmentKindSchema.default("assignment").describe(
      "assignment = single-submission; project = multi-milestone with kind-specific eligibility gate.",
    ),
    title: z.string().min(1).max(200),
    instructions: z.string().max(10_000).optional().describe("Rich-text instructions (HTML/Markdown)."),
    maxScore: z.number().int().min(1).max(10_000).describe("Maximum achievable score in integer points."),
    dueAt: IsoDateTimeSchema.optional().describe("Submission deadline. Null = no deadline."),
    allowResubmit: z.boolean().default(false).describe(
      "Whether a student may submit again after grading/return.",
    ),
    isFinal: z.boolean().default(false).describe(
      "Only for kind='project'. If true, this is the final project whose approval gates " +
        "certificate eligibility (eligibility rule sub-condition 3).",
    ),
    milestones: z
      .array(MilestoneInputSchema)
      .optional()
      .describe("Project milestones. Only for kind='project'. Ignored for kind='assignment'."),
  })
  .strict();
export type CreateAssignmentRequest = z.infer<typeof CreateAssignmentRequestSchema>;

/**
 * PATCH /api/v1/crm/assignments/:id
 *
 * Update an existing assignment. All fields are optional (partial update).
 * Permission: assignments.edit (scope: assigned).
 */
export const UpdateAssignmentRequestSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    instructions: z.string().max(10_000).optional(),
    maxScore: z.number().int().min(1).max(10_000).optional(),
    dueAt: IsoDateTimeSchema.nullable().optional(),
    allowResubmit: z.boolean().optional(),
    isFinal: z.boolean().optional(),
  })
  .strict();
export type UpdateAssignmentRequest = z.infer<typeof UpdateAssignmentRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs — CRM authoring view (full detail incl. milestones)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Full assignment detail — returned to faculty/ops for the authoring/grading view.
 * Includes milestones array (empty for kind='assignment').
 */
export const AssignmentDetailSchema = z.object({
  id: UuidSchema,
  lessonId: UuidSchema,
  lessonTitle: z.string(),
  /**
   * The COURSE this hangs off, resolved lesson → module → program.
   *
   * Staff think in courses ("the Neurology case study"), not lessons, and the CRM needs it
   * to scope a batch picker to the cohorts that could actually have submitted. Empty string
   * on rows built from the list query, which does not join it.
   */
  programId: z.string(),
  programTitle: z.string(),
  kind: AssignmentKindSchema,
  title: z.string(),
  instructions: z.string().nullable(),
  maxScore: z.number().int().min(1),
  dueAt: IsoDateTimeSchema.nullable(),
  allowResubmit: z.boolean(),
  isFinal: z.boolean(),
  milestones: z.array(MilestoneSchema),
  submissionCount: z.number().int().min(0).describe("Total submissions for this assignment."),
  gradedCount: z.number().int().min(0).describe("Submissions with status=graded."),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type AssignmentDetail = z.infer<typeof AssignmentDetailSchema>;

/**
 * List row for CRM assignment management table.
 */
export const AssignmentSummarySchema = z.object({
  id: UuidSchema,
  lessonId: UuidSchema,
  lessonTitle: z.string(),
  kind: AssignmentKindSchema,
  title: z.string(),
  maxScore: z.number().int().min(1),
  dueAt: IsoDateTimeSchema.nullable(),
  allowResubmit: z.boolean(),
  isFinal: z.boolean(),
  milestoneCount: z.number().int().min(0),
  submissionCount: z.number().int().min(0),
  gradedCount: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
});
export type AssignmentSummary = z.infer<typeof AssignmentSummarySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs — Student view (LMS)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Student-facing assignment list item.
 * `status` is server-derived (not a DB column).
 * Does NOT include instructions (full content loaded on detail view only).
 */
export const AssignmentListItemSchema = z.object({
  id: UuidSchema,
  lessonId: UuidSchema,
  lessonTitle: z.string(),
  kind: AssignmentKindSchema,
  title: z.string(),
  maxScore: z.number().int().min(1),
  dueAt: IsoDateTimeSchema.nullable(),
  allowResubmit: z.boolean(),
  isFinal: z.boolean(),
  milestoneCount: z.number().int().min(0),
  status: AssignmentStudentStatusSchema.describe(
    "Server-derived: assigned=not yet submitted; submitted=awaiting grade; graded=scored; " +
      "overdue=due date passed without submission.",
  ),
  submittedAt: IsoDateTimeSchema.nullable(),
  score: z.number().int().nullable().describe("Null until graded."),
  maxScoreDisplay: z.number().int().describe("Always populated, same as maxScore."),
});
export type AssignmentListItem = z.infer<typeof AssignmentListItemSchema>;

/**
 * Student-facing assignment detail.
 * Returns full instructions + milestone list + own submission snapshot.
 * Submission detail (grade/rubric/feedback) is in SubmissionDetailSchema.
 */
export const AssignmentStudentDetailSchema = z.object({
  id: UuidSchema,
  lessonId: UuidSchema,
  lessonTitle: z.string(),
  kind: AssignmentKindSchema,
  title: z.string(),
  instructions: z.string().nullable(),
  maxScore: z.number().int().min(1),
  dueAt: IsoDateTimeSchema.nullable(),
  allowResubmit: z.boolean(),
  isFinal: z.boolean(),
  milestones: z.array(MilestoneSchema),
  status: AssignmentStudentStatusSchema,
  mySubmission: z
    .object({
      id: UuidSchema,
      status: SubmissionStatusSchema,
      attemptNo: z.number().int().min(1),
      submittedAt: IsoDateTimeSchema,
      score: z.number().int().nullable(),
      feedback: z.string().nullable(),
      milestoneId: UuidSchema.nullable(),
    })
    .nullable()
    .describe("The student's most recent submission for this assignment, or null if none."),
});
export type AssignmentStudentDetail = z.infer<typeof AssignmentStudentDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Submission DTOs
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/assignments/:id/submit
 * POST /api/v1/assignments/:id/milestones/:milestoneId/submit
 *
 * Student submits an assignment or project milestone.
 * `files` is an array of StorageProvider keys obtained via the signed upload URL flow
 * (GET /storage/upload-url → PUT to signed URL → then include returned key here).
 * At least one of files, text, or link must be present.
 *
 * Permission: submissions.create (scope: own).
 */
export const SubmitAssignmentRequestSchema = z
  .object({
    files: z
      .array(z.string().min(1).max(1000))
      .default([])
      .describe(
        "Array of StorageProvider storage keys (NOT raw URLs). Obtain these via POST /storage/upload-url " +
          "then PUT to the signed URL. Example key: 'submissions/tenant-abc/enroll-xyz/report.pdf'.",
      ),
    text: z
      .string()
      .max(50_000)
      .optional()
      .describe("Optional text submission (rich-text or plain). Sanitized server-side before display."),
    link: z
      .string()
      .url()
      .max(2000)
      .optional()
      .describe("Optional external link (repository URL, Figma link, etc.)."),
  })
  .refine((val) => val.files.length > 0 || val.text !== undefined || val.link !== undefined, {
    message: "At least one of files, text, or link must be provided.",
  })
  .describe("Student submission payload. At least one of files/text/link is required.");
export type SubmitAssignmentRequest = z.infer<typeof SubmitAssignmentRequestSchema>;

/**
 * PATCH /api/v1/submissions/:id/grade
 *
 * Faculty grades a submission. Sets status=graded, populates score/rubric/feedback.
 * An audit log entry is written with before/after values on every call (including re-grades).
 *
 * Permission: submissions.grade (scope: assigned — submission must be in an assigned batch).
 */
export const GradeSubmissionRequestSchema = z
  .object({
    score: z
      .number()
      .int()
      .min(0)
      .describe("Score in integer points. Must be ≤ assignment.max_score (validated server-side)."),
    rubric: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Rubric breakdown JSON (criterion key → value). Open structure from RubricGrader."),
    feedback: z
      .string()
      .max(10_000)
      .optional()
      .describe("Faculty feedback text. Rendered in LMS with DOMPurify (student-facing)."),
  })
  .strict();
export type GradeSubmissionRequest = z.infer<typeof GradeSubmissionRequestSchema>;

/**
 * `POST /api/v1/crm/submissions/:id/return` — send the work back for changes.
 *
 * The other half of review, and until now the missing one: `SubmissionStatus.returned` has
 * existed since Phase 4 and nothing in the API ever wrote it, so a reviewer could only ever
 * approve. Returning carries NO score — it is not a fail (that is a low `graded` score), it
 * is "this needs another attempt".
 *
 * `reason` is REQUIRED and has a floor, because it is the entire student-facing payload of
 * this action: they are told their project was sent back and shown exactly this text. "No"
 * is not something a student can act on, and an empty reason turns a review into a rejection
 * with no route forward.
 */
export const ReturnSubmissionRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, "Give the student something to act on, at least 10 characters.")
      .max(10_000)
      .describe("Shown to the student verbatim. Stored in submissions.feedback."),
  })
  .strict();
export type ReturnSubmissionRequest = z.infer<typeof ReturnSubmissionRequestSchema>;

/**
 * Submission detail — student view.
 * Own grade + rubric + feedback visible. Never includes another student's data.
 * `fileDownloadUrls` are short-lived signed GET URLs minted on request (never raw bucket URLs).
 */
export const SubmissionDetailSchema = z.object({
  id: UuidSchema,
  assignmentId: UuidSchema,
  milestoneId: UuidSchema.nullable(),
  enrollmentId: UuidSchema,
  status: SubmissionStatusSchema,
  attemptNo: z.number().int().min(1),
  fileDownloadUrls: z
    .array(
      z.object({
        key: z.string().describe("StorageProvider key (server-internal reference)."),
        url: z.string().url().describe("Short-lived signed GET URL. Never cache this."),
        expiresAt: IsoDateTimeSchema.describe("When this signed URL expires."),
      }),
    )
    .describe(
      "Signed download URLs for submitted files. Each URL is short-lived. " +
        "Re-call the endpoint or dedicated download-url endpoint to get fresh URLs.",
    ),
  text: z.string().nullable(),
  link: z.string().nullable(),
  submittedAt: IsoDateTimeSchema,
  // Grade fields — null until status=graded
  score: z.number().int().nullable(),
  maxScore: z.number().int(),
  rubric: z.record(z.string(), z.unknown()).nullable(),
  feedback: z.string().nullable().describe("Sanitize with DOMPurify before rendering (may contain HTML)."),
  gradedAt: IsoDateTimeSchema.nullable(),
  gradedByName: z.string().nullable().describe("Display name of the faculty member who graded."),
});
export type SubmissionDetail = z.infer<typeof SubmissionDetailSchema>;

/**
 * Submission list item for faculty grading queue (CRM).
 * Includes student name + current status for the grading table.
 */
export const SubmissionSummarySchema = z.object({
  id: UuidSchema,
  assignmentId: UuidSchema,
  assignmentTitle: z.string(),
  milestoneId: UuidSchema.nullable(),
  milestoneTitle: z.string().nullable(),
  enrollmentId: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  /**
   * The cohort this submission came from. Reviewers work a batch at a time — "who in the
   * September batch still owes me this?" — and the server already resolves the batch on
   * every row for the faculty assigned-scope check, so surfacing it costs nothing.
   */
  batchId: UuidSchema,
  batchName: z.string(),
  status: SubmissionStatusSchema,
  attemptNo: z.number().int().min(1),
  score: z.number().int().nullable(),
  maxScore: z.number().int(),
  submittedAt: IsoDateTimeSchema,
  gradedAt: IsoDateTimeSchema.nullable(),
});
export type SubmissionSummary = z.infer<typeof SubmissionSummarySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Project-specific DTOs (project = assignment.kind=project + milestones)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Milestone review state — one entry per milestone for the project detail view.
 * `status` mirrors the latest submission status for this milestone (or 'not_submitted').
 */
export const MilestoneReviewStateSchema = z.object({
  milestone: MilestoneSchema,
  submissionId: UuidSchema.nullable(),
  submissionStatus: SubmissionStatusSchema.nullable().describe(
    "Null if student has not yet submitted for this milestone.",
  ),
  score: z.number().int().nullable(),
  feedback: z.string().nullable().describe("Faculty feedback for this milestone (sanitize before render)."),
  submittedAt: IsoDateTimeSchema.nullable(),
  gradedAt: IsoDateTimeSchema.nullable(),
});
export type MilestoneReviewState = z.infer<typeof MilestoneReviewStateSchema>;

/**
 * Project detail — combines the assignment with per-milestone review state.
 * Used in both LMS (student own-view) and CRM (faculty assigned-batch view).
 */
export const ProjectDetailSchema = z.object({
  assignment: AssignmentDetailSchema,
  milestoneStates: z.array(MilestoneReviewStateSchema),
  overallStatus: z.enum(["not_started", "in_progress", "under_review", "graded"]).describe(
    "Server-derived overall project state: not_started = no milestone submitted; " +
      "in_progress = some submitted not all; under_review = all submitted awaiting grade; " +
      "graded = all milestones graded.",
  ),
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// List query params
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/crm/assignments
 * GET /api/v1/me/assignments (LMS)
 */
export const ListAssignmentsQuerySchema = z
  .object({
    lessonId: UuidSchema.optional(),
    kind: AssignmentKindSchema.optional(),
    status: SubmissionStatusSchema.optional().describe("Filter by submission status (CRM grading queue use case)."),
    search: z.string().min(1).max(200).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListAssignmentsQuery = z.infer<typeof ListAssignmentsQuerySchema>;

/**
 * GET /api/v1/crm/assignments/:id/submissions
 */
export const ListSubmissionsQuerySchema = z
  .object({
    status: SubmissionStatusSchema.optional(),
    search: z.string().min(1).max(200).optional().describe("Filter by student name."),
    batchId: UuidSchema.optional().describe("Narrow the queue to one cohort."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListSubmissionsQuery = z.infer<typeof ListSubmissionsQuerySchema>;
