// Assessment + Attempt contracts — Phase 4, Wave 2
// (docs/plans/phase-4.md task #2, docs/specs/phase-4-learning-depth.md).
//
// SECURITY-CRITICAL DESIGN: answer-key isolation
// ─────────────────────────────────────────────────────────────────────────
// The `answer_key` column on assessment_questions is SERVER-ONLY. It must
// NEVER appear in any DTO that reaches a student's browser.
//
// This is enforced at two layers:
//   1. TYPE LAYER (this file): `AssessmentQuestionPublicSchema` structurally
//      omits `answerKey`/`isCorrect`/`correctOption` fields. The compile-time
//      assertion at the bottom of this file proves this with `satisfies` + a
//      type-level check that ensures the field cannot be added accidentally.
//   2. REPOSITORY LAYER (backend): Prisma selects for student-facing queries
//      must use explicit `select: { answerKey: false }` (never `select: *`).
//      The integration test asserts the raw HTTP response JSON contains zero
//      occurrences of "answerKey", "answer_key", "isCorrect", "is_correct",
//      "correctOption", or "correct_option" (AC-D2, AC-J9).
//
// Do NOT add `answerKey`, `isCorrect`, or `correctOption` to
// `AssessmentQuestionPublicSchema` — this would break the security guarantee.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const AssessmentTypeSchema = z.enum(["quiz", "test"]);
export type AssessmentType = z.infer<typeof AssessmentTypeSchema>;

export const QuestionTypeSchema = z.enum(["mcq", "descriptive"]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

// ─────────────────────────────────────────────────────────────────────────
// MCQ option (public — no is_correct flag)
// ─────────────────────────────────────────────────────────────────────────

/**
 * A single MCQ choice as seen by a student.
 * MUST NOT contain `isCorrect`, `is_correct`, or any correctness indicator.
 * The `answer_key` column on the DB row holds the correct option id(s) server-side.
 */
export const McqOptionSchema = z.object({
  id: z.string().min(1).max(100).describe("Stable choice identifier (e.g. 'opt-a')."),
  text: z.string().min(1).max(2000).describe("Choice text shown to the student."),
  // NO isCorrect / is_correct / correctOption here — answer-key isolation (AC-D2/AC-J9).
});
export type McqOption = z.infer<typeof McqOptionSchema>;

// ─────────────────────────────────────────────────────────────────────────
// AssessmentQuestionPublic — student-facing DTO
//
// SECURITY: this type MUST NOT contain any of:
//   - answerKey / answer_key
//   - isCorrect / is_correct
//   - correctOption / correct_option
//
// The type-level assertion below proves this at compile time.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Assessment question as seen by a student (in-attempt or on attempt start).
 *
 * SECURITY GUARANTEE: no answer key, no correctness indicators. The `options`
 * array for MCQ questions contains ONLY `{id, text}` pairs — no `isCorrect`
 * or similar field. Descriptive questions have `options: null`.
 *
 * Backend: only select this projection for student-facing endpoints.
 * DO NOT add `answerKey`, `isCorrect`, or `correctOption` to this schema.
 */
export const AssessmentQuestionPublicSchema = z.object({
  id: UuidSchema,
  type: QuestionTypeSchema,
  prompt: z.string().min(1).describe("The question prompt/stem shown to the student."),
  options: z.array(McqOptionSchema).nullable().describe(
    "MCQ choices. Each item is {id, text} ONLY, no correctness indicator. " +
      "Null for descriptive questions.",
  ),
  points: z.number().int().min(1).describe("Point value for this question."),
  order: z.number().int().min(0).describe("Display order (server-shuffled when assessment.shuffle=true)."),
  // BANNED FIELDS (type-level assertion proves absence):
  // answerKey — NEVER
  // isCorrect — NEVER
  // correctOption — NEVER
});
export type AssessmentQuestionPublic = z.infer<typeof AssessmentQuestionPublicSchema>;

// ─── COMPILE-TIME ASSERTION: answerKey is absent from AssessmentQuestionPublic ───
// This assertion will cause a TypeScript compile error if `answerKey` is ever
// accidentally added to AssessmentQuestionPublicSchema. The `satisfies` operator
// checks the type without widening it. We assert that the type cannot be assigned
// to a type that requires `answerKey`, and that the key is not present.
type _AssertNoAnswerKey = "answerKey" extends keyof AssessmentQuestionPublic
  ? never // This branch must never be reached — if it is, the type has answerKey
  : "answerKey is correctly absent from AssessmentQuestionPublic";

// This const causes a compile error if the assertion fails (never cannot be
// satisfied, so `_assertAnswerKeyAbsent` would have type `never`).
const _assertAnswerKeyAbsent: _AssertNoAnswerKey =
  "answerKey is correctly absent from AssessmentQuestionPublic";

// Secondary assertions for other banned fields:
type _AssertNoIsCorrect = "isCorrect" extends keyof AssessmentQuestionPublic ? never : true;
const _assertIsCorrectAbsent: _AssertNoIsCorrect = true;

type _AssertNoCorrectOption = "correctOption" extends keyof AssessmentQuestionPublic ? never : true;
const _assertCorrectOptionAbsent: _AssertNoCorrectOption = true;

// Suppress "unused variable" lint — these are intentional compile-time checks.
void _assertAnswerKeyAbsent;
void _assertIsCorrectAbsent;
void _assertCorrectOptionAbsent;

// ─────────────────────────────────────────────────────────────────────────
// AssessmentQuestion — faculty/author DTO (includes answer_key)
//
// NEVER use this DTO in a student-facing endpoint.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Assessment question as seen by faculty for authoring (includes answer key).
 *
 * WARNING: this DTO MUST NEVER be sent to a student. It is for CRM authoring
 * surfaces only (permission: assessments.create/edit, scope: assigned).
 *
 * For MCQ: `answerKey` contains the correct option id(s).
 * For descriptive: `answerKey` is a rubric descriptor JSON for manual grading guidance.
 */
export const AssessmentQuestionAuthorSchema = AssessmentQuestionPublicSchema.extend({
  answerKey: z
    .union([
      z.string().min(1).describe("Single correct option id for MCQ single-select."),
      z.array(z.string().min(1)).describe("Array of correct option ids for MCQ multi-select."),
      z.record(z.string(), z.unknown()).describe("Rubric descriptor JSON for descriptive questions."),
    ])
    .nullable()
    .describe(
      "SERVER-ONLY. Correct option id(s) for MCQ, or rubric descriptor for descriptive. " +
        "NEVER serialize to a student-facing response.",
    ),
});
export type AssessmentQuestionAuthor = z.infer<typeof AssessmentQuestionAuthorSchema>;

/**
 * Input DTO for a question when authoring an assessment (faculty).
 */
export const QuestionInputSchema = z
  .object({
    type: QuestionTypeSchema,
    prompt: z.string().min(1).max(5000),
    options: z
      .array(McqOptionSchema)
      .min(2)
      .max(10)
      .optional()
      .describe("Required for MCQ. Each option is {id, text}. No isCorrect field here."),
    answerKey: z
      .union([
        z.string().min(1),
        z.array(z.string().min(1)),
        z.record(z.string(), z.unknown()),
      ])
      .nullable()
      .optional()
      .describe("Correct option id(s) for MCQ, or rubric descriptor for descriptive."),
    points: z.number().int().min(1).max(100),
    order: z.number().int().min(0),
  })
  .strict();
export type QuestionInput = z.infer<typeof QuestionInputSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Assessment author DTOs (CRM, assigned-scope)
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crm/assessments
 *
 * Faculty creates an assessment on a module.
 * `questions` is submitted inline on creation (the backend creates AssessmentQuestion rows).
 * `timeLimitS`: null = untimed assessment.
 * `passPct`: 0–100 percentage of total points required to pass.
 * `isRequired`: if true, this assessment must be passed for certificate eligibility.
 *
 * Permission: assessments.create (scope: assigned).
 */
export const CreateAssessmentRequestSchema = z
  .object({
    moduleId: UuidSchema.describe("The module this assessment is attached to."),
    title: z.string().min(1).max(200),
    type: AssessmentTypeSchema.default("quiz"),
    timeLimitS: z
      .number()
      .int()
      .min(60)
      .max(14_400)
      .nullable()
      .optional()
      .describe("Time limit in seconds. Null = untimed."),
    passPct: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe("Pass threshold as a percentage of total points. E.g. 70 = 70%."),
    attemptsAllowed: z.number().int().min(1).max(10).default(1),
    isRequired: z
      .boolean()
      .default(false)
      .describe(
        "If true, this assessment must be passed for certificate eligibility " +
          "(certificate eligibility sub-condition 2). Vacuously true if no required assessments exist.",
      ),
    shuffle: z.boolean().default(true).describe("Randomize question order per attempt (server-side)."),
    questions: z.array(QuestionInputSchema).min(1).max(100),
  })
  .strict();
export type CreateAssessmentRequest = z.infer<typeof CreateAssessmentRequestSchema>;

/**
 * PATCH /api/v1/crm/assessments/:id
 *
 * Update assessment metadata (NOT questions inline — use the questions sub-resource).
 * Permission: assessments.edit (scope: assigned).
 */
export const UpdateAssessmentRequestSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    type: AssessmentTypeSchema.optional(),
    timeLimitS: z.number().int().min(60).max(14_400).nullable().optional(),
    passPct: z.number().int().min(0).max(100).optional(),
    attemptsAllowed: z.number().int().min(1).max(10).optional(),
    isRequired: z.boolean().optional(),
    shuffle: z.boolean().optional(),
  })
  .strict();
export type UpdateAssessmentRequest = z.infer<typeof UpdateAssessmentRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Assessment response DTOs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Full assessment detail — faculty/CRM view. Includes questions WITH answer keys.
 * WARNING: NEVER return this to students.
 */
export const AssessmentDetailAuthorSchema = z.object({
  id: UuidSchema,
  moduleId: UuidSchema,
  moduleTitle: z.string(),
  title: z.string(),
  type: AssessmentTypeSchema,
  timeLimitS: z.number().int().nullable(),
  passPct: z.number().int().min(0).max(100),
  attemptsAllowed: z.number().int().min(1),
  isRequired: z.boolean(),
  shuffle: z.boolean(),
  questions: z.array(AssessmentQuestionAuthorSchema).describe("Questions WITH answer keys, author view only."),
  totalPoints: z.number().int().min(0).describe("Sum of all question.points."),
  attemptCount: z.number().int().min(0).describe("Total attempts taken by students."),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type AssessmentDetailAuthor = z.infer<typeof AssessmentDetailAuthorSchema>;

/**
 * Assessment list summary row (CRM + LMS both use this — no answer keys).
 */
export const AssessmentSummarySchema = z.object({
  id: UuidSchema,
  moduleId: UuidSchema,
  moduleTitle: z.string(),
  title: z.string(),
  type: AssessmentTypeSchema,
  timeLimitS: z.number().int().nullable(),
  passPct: z.number().int().min(0).max(100),
  attemptsAllowed: z.number().int().min(1),
  isRequired: z.boolean(),
  shuffle: z.boolean(),
  questionCount: z.number().int().min(0),
  totalPoints: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
});
export type AssessmentSummary = z.infer<typeof AssessmentSummarySchema>;

/**
 * Student-facing assessment detail.
 * Questions use AssessmentQuestionPublicSchema — NO answer key, NO isCorrect.
 * Questions may be shuffled per-attempt (order is attempt-specific, not canonical).
 */
export const AssessmentDetailPublicSchema = z.object({
  id: UuidSchema,
  moduleId: UuidSchema,
  moduleTitle: z.string(),
  title: z.string(),
  type: AssessmentTypeSchema,
  timeLimitS: z.number().int().nullable(),
  passPct: z.number().int().min(0).max(100),
  attemptsAllowed: z.number().int().min(1),
  isRequired: z.boolean(),
  shuffle: z.boolean(),
  questionCount: z.number().int().min(0),
  totalPoints: z.number().int().min(0),
  attemptsUsed: z.number().int().min(0).describe("Submitted attempts used in the CURRENT attempt wave (resets after a cooldown)."),
  attemptsRemaining: z.number().int().min(0).describe("attemptsAllowed - attemptsUsed (within the current wave)."),
  hasPassingAttempt: z.boolean().describe("Whether the student has any attempt with passed=true."),
  /**
   * When a student has used all attempts in the current wave, this is the ISO time the
   * cooldown lifts and a fresh set of attempts opens automatically. Null when attempts still
   * remain, when the student has already passed, or when the assessment allows no retries.
   */
  retryAvailableAt: IsoDateTimeSchema.nullable().default(null).describe(
    "ISO time the attempt cooldown lifts and attempts reopen. Null unless currently in cooldown.",
  ),
  // No questions here — questions are delivered with the attempt (on start).
});
export type AssessmentDetailPublic = z.infer<typeof AssessmentDetailPublicSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Attempt DTOs
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/assessments/:id/attempts
 *
 * Student starts a new attempt. Server sets:
 *   - started_at = NOW()
 *   - time_expires_at = NOW() + assessment.time_limit_s (null if untimed)
 *   - attempt_no = previous count + 1
 *
 * Returns the attempt detail INCLUDING the shuffled questions (no answer key).
 *
 * Permission: attempts.take (scope: own).
 * Errors: 422 ATTEMPTS_EXHAUSTED if attempts_allowed exhausted,
 *         422 ATTEMPT_IN_PROGRESS if an unsubmitted non-expired attempt exists.
 */
export const StartAttemptRequestSchema = z.object({}).strict().describe(
  "No body required. The server resolves assessment, enrollment, and timing server-side.",
);
export type StartAttemptRequest = z.infer<typeof StartAttemptRequestSchema>;

/**
 * Student answer for a single question in a PUT /attempts/:id submission.
 */
export const AttemptAnswerSchema = z.object({
  questionId: UuidSchema,
  value: z
    .union([
      z.string().describe("MCQ: chosen option id. Descriptive: response text."),
      z.array(z.string()).describe("MCQ multi-select: array of chosen option ids."),
    ])
    .describe(
      "For MCQ: the chosen option id string (or array for multi-select). " +
        "For descriptive: the student's response text. Empty string is valid (no answer).",
    ),
});
export type AttemptAnswer = z.infer<typeof AttemptAnswerSchema>;

/**
 * PUT /api/v1/attempts/:id
 *
 * Student submits answers for an in-progress attempt.
 * - Server checks NOW() <= time_expires_at before accepting (422 ATTEMPT_EXPIRED if late).
 * - MCQ auto-graded server-side against answer_key (never revealed to student).
 * - Descriptive questions → score=0/passed=null until manual grade.
 * - Idempotent: re-submitting an already-submitted attempt returns 200 with cached result.
 *
 * Permission: attempts.take (scope: own).
 */
export const SubmitAttemptRequestSchema = z
  .object({
    answers: z.array(AttemptAnswerSchema).describe(
      "One entry per question the student answered. Unanswered questions may be omitted " +
        "(score 0 for MCQ, empty string stored for descriptive).",
    ),
    flags: z
      .object({
        tabSwitchCount: z.number().int().min(0).optional().describe(
          "Client-reported tab switch count (advisory signal, not a hard block). " +
            "Stored in attempt.flags for faculty review.",
        ),
      })
      .optional()
      .describe("Client-reported anti-cheat signals (basics only per P4 scope)."),
  })
  .strict();
export type SubmitAttemptRequest = z.infer<typeof SubmitAttemptRequestSchema>;

/**
 * PATCH /api/v1/attempts/:id/flag
 *
 * Client reports a tab-switch or focus-loss event during the attempt.
 * Does NOT auto-submit or terminate the attempt (basics only per P4 LOCK-1).
 * Increments attempts.flags.tabSwitchCount on the server.
 *
 * Permission: attempts.take (scope: own, must be the attempt owner).
 */
export const FlagAttemptRequestSchema = z
  .object({
    event: z.enum(["tab_switch", "focus_loss"]).describe("The anti-cheat signal type."),
  })
  .strict();
export type FlagAttemptRequest = z.infer<typeof FlagAttemptRequestSchema>;

/**
 * Per-question result — shown to student after submission.
 * MCQ: includes whether their answer was correct (post-submit only).
 * Descriptive: no correctness indicator (manual grade by faculty).
 * NEVER includes the answer key itself.
 */
export const QuestionResultSchema = z.object({
  questionId: UuidSchema,
  type: QuestionTypeSchema,
  earnedPoints: z.number().int().min(0).describe("Points earned for this question."),
  maxPoints: z.number().int().min(1),
  // For MCQ, server tells the student whether they got it right (post-submit only).
  // The correct option id(s) are NOT revealed — only correctness of their answer.
  isCorrectForMcq: z.boolean().nullable().describe(
    "For MCQ: true if the student's answer matched the answer key. " +
      "Null for descriptive questions (awaiting manual grade). " +
      "The CORRECT answer key is never revealed. Only correctness of the student's own answer.",
  ),
  // Descriptive questions: pending manual grade from faculty.
  isPendingManualGrade: z.boolean().describe(
    "True for descriptive questions pending faculty review.",
  ),
});
export type QuestionResult = z.infer<typeof QuestionResultSchema>;

/**
 * Attempt result — returned in the response to PUT /attempts/:id (submit).
 * Also returned by GET /attempts/:id post-submission.
 *
 * `passed` is null until:
 *   - MCQ-only attempt: set immediately at auto-grade time.
 *   - Any descriptive questions: set by faculty via PUT /attempts/:id/grade.
 *
 * `timeExpiresAt` is null for untimed assessments.
 * `questionResults` is null for in-progress attempts (only populated post-submit).
 */
export const AttemptResultSchema = z.object({
  id: UuidSchema,
  assessmentId: UuidSchema,
  assessmentTitle: z.string(),
  enrollmentId: UuidSchema,
  attemptNo: z.number().int().min(1),
  startedAt: IsoDateTimeSchema,
  submittedAt: IsoDateTimeSchema.nullable().describe("Null if attempt is still in-progress."),
  timeExpiresAt: IsoDateTimeSchema.nullable().describe("Server-computed expiry. Null if untimed."),
  score: z.number().int().nullable().describe("Total points earned. Null until submitted."),
  totalPoints: z.number().int().describe("Maximum possible points (sum of all question.points)."),
  passPct: z.number().int().min(0).max(100),
  passed: z.boolean().nullable().describe(
    "True if score/totalPoints >= passPct/100. Null until submitted (or until manual grade for descriptive).",
  ),
  attemptsRemaining: z.number().int().min(0).describe(
    "How many more attempts the student can start after this one.",
  ),
  questionResults: z.array(QuestionResultSchema).nullable().describe(
    "Per-question results. Null for in-progress attempts. Only populated post-submit.",
  ),
  flags: z
    .object({
      tabSwitchCount: z.number().int().min(0),
    })
    .describe("Anti-cheat signals recorded on this attempt."),
  hasPendingManualGrade: z.boolean().describe(
    "True if at least one descriptive question awaits faculty grading.",
  ),
});
export type AttemptResult = z.infer<typeof AttemptResultSchema>;

/**
 * In-progress attempt detail — returned by POST /assessments/:id/attempts (start).
 * Includes the shuffled questions (WITHOUT answer keys).
 */
export const AttemptInProgressSchema = z.object({
  attempt: AttemptResultSchema,
  questions: z.array(AssessmentQuestionPublicSchema).describe(
    "Questions for this attempt in shuffled order (if assessment.shuffle=true). " +
      "NO answer keys. NO isCorrect. Student answers are submitted via PUT /attempts/:id.",
  ),
});
export type AttemptInProgress = z.infer<typeof AttemptInProgressSchema>;

/**
 * Manual grade DTO — faculty grades descriptive questions after student submits.
 * PUT /api/v1/attempts/:id/grade
 *
 * Permission: attempts.grade (scope: assigned).
 * Error: 422 MANUAL_GRADE_NOT_APPLICABLE for MCQ-only attempts.
 */
export const GradeAttemptRequestSchema = z
  .object({
    questionGrades: z.array(
      z.object({
        questionId: UuidSchema,
        earnedPoints: z.number().int().min(0).describe("Faculty-assigned points for this descriptive question."),
        feedback: z.string().max(5000).optional().describe("Faculty feedback for this question."),
      }),
    ),
    passed: z.boolean().describe(
      "Faculty sets this after grading all descriptive questions. " +
        "Once set, feeds into certificate eligibility (sub-condition 2).",
    ),
  })
  .strict();
export type GradeAttemptRequest = z.infer<typeof GradeAttemptRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// List query params
// ─────────────────────────────────────────────────────────────────────────

export const ListAssessmentsQuerySchema = z
  .object({
    moduleId: UuidSchema.optional(),
    type: AssessmentTypeSchema.optional(),
    isRequired: z.coerce.boolean().optional(),
    search: z.string().min(1).max(200).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListAssessmentsQuery = z.infer<typeof ListAssessmentsQuerySchema>;
