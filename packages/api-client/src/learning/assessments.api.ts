// Assessments + Attempts SDK — Phase 4, Wave 2
// (docs/plans/phase-4.md task #2).
//
// Namespace: client.learning.assessments.*
//
// SECURITY GUARANTEE (answer-key isolation, AC-D2/AC-J9):
//   - The `AssessmentQuestionPublic` DTO has NO answerKey, NO isCorrect, NO correctOption.
//   - The CRM `AssessmentDetailAuthor` DTO (with answerKey) is NEVER returned by student
//     endpoints — it is only returned by GET /crm/assessments/:id.
//   - The type-level assertion in @repo/types assessments.schemas.ts proves this at compile time.
//   - An integration test scans the raw response JSON for banned strings (AC-J9).
//
// Endpoints covered:
//   CRM (faculty authoring / grading):
//     GET  /crm/assessments              → list()
//     POST /crm/assessments              → create()
//     GET  /crm/assessments/:id          → get()     [includes answer keys — CRM ONLY]
//     PATCH /crm/assessments/:id         → update()
//     PUT  /crm/attempts/:id/grade       → gradeAttempt() [descriptive manual grade]
//
//   LMS (student, own-scope):
//     GET  /me/assessments               → listMine()    [no answer keys]
//     GET  /me/assessments/:id           → getMine()     [no answer keys]
//     POST /me/assessments/:id/attempts  → startAttempt() [shuffled questions, no answer keys]
//     PUT  /me/attempts/:id              → submitAttempt() [idempotent; MCQ auto-graded server-side]
//     GET  /me/attempts/:id              → getAttempt()
//     PATCH /me/attempts/:id/flag        → flagAttempt() [tab-switch advisory signal]

import type {
  AssessmentDetailAuthor,
  AssessmentSummary,
  AssessmentDetailPublic,
  CreateAssessmentRequest,
  UpdateAssessmentRequest,
  SubmitAttemptRequest,
  FlagAttemptRequest,
  AttemptResult,
  AttemptInProgress,
  GradeAttemptRequest,
  ListAssessmentsQuery,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class AssessmentsApi {
  constructor(private readonly client: ApiClient) {}

  // ─── CRM / faculty authoring ─────────────────────────────────────────────

  /**
   * GET /api/v1/crm/assessments
   * List assessments (no answer keys in list view).
   * Permission: assessments.view (scope: assigned|all).
   */
  async list(query?: Partial<ListAssessmentsQuery>) {
    return this.client.requestPaginated<AssessmentSummary>(
      "GET",
      `/api/v1/crm/assessments${toQueryString(query ?? {})}`,
    );
  }

  /**
   * POST /api/v1/crm/assessments
   *
   * Creates assessment + question rows atomically.
   * Answer keys in `questions[].answerKey` are stored server-side and
   * NEVER returned to students.
   *
   * Permission: assessments.create (scope: assigned).
   */
  async create(
    body: CreateAssessmentRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<AssessmentDetailAuthor> {
    return this.client.request<AssessmentDetailAuthor>("POST", "/api/v1/crm/assessments", {
      body,
      idempotencyKey,
    });
  }

  /**
   * GET /api/v1/crm/assessments/:id
   *
   * Full assessment detail INCLUDING questions WITH answer keys.
   * *** CRM/FACULTY ONLY — NEVER call from a student-facing surface. ***
   *
   * Permission: assessments.view (scope: assigned|all).
   */
  async get(id: string): Promise<AssessmentDetailAuthor> {
    return this.client.request<AssessmentDetailAuthor>("GET", `/api/v1/crm/assessments/${id}`);
  }

  /**
   * PATCH /api/v1/crm/assessments/:id
   * Partial update of assessment metadata.
   * Permission: assessments.edit (scope: assigned).
   */
  async update(
    id: string,
    body: UpdateAssessmentRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<AssessmentDetailAuthor> {
    return this.client.request<AssessmentDetailAuthor>(
      "PATCH",
      `/api/v1/crm/assessments/${id}`,
      { body, idempotencyKey },
    );
  }

  /**
   * PUT /api/v1/crm/attempts/:id/grade
   *
   * Faculty manually grades descriptive questions on an attempt.
   * Error: 422 MANUAL_GRADE_NOT_APPLICABLE for MCQ-only attempts.
   * Permission: attempts.grade (scope: assigned).
   */
  async gradeAttempt(
    attemptId: string,
    body: GradeAttemptRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<AttemptResult> {
    return this.client.request<AttemptResult>(
      "PUT",
      `/api/v1/crm/attempts/${attemptId}/grade`,
      { body, idempotencyKey },
    );
  }

  // ─── LMS / student (own-scope) ───────────────────────────────────────────

  /**
   * GET /api/v1/me/assessments
   *
   * Student's assessments with attempt stats.
   * NO answer keys. NO questions in this response.
   * Permission: assessments.view (scope: own).
   */
  async listMine(query?: Partial<ListAssessmentsQuery>) {
    return this.client.requestPaginated<AssessmentSummary>(
      "GET",
      `/api/v1/me/assessments${toQueryString(query ?? {})}`,
    );
  }

  /**
   * GET /api/v1/me/assessments/:id
   *
   * Assessment metadata + attempt stats for the student.
   * NO questions, NO answer keys (questions delivered with attempt on start).
   * Permission: assessments.view (scope: own).
   */
  async getMine(id: string): Promise<AssessmentDetailPublic> {
    return this.client.request<AssessmentDetailPublic>("GET", `/api/v1/me/assessments/${id}`);
  }

  /**
   * POST /api/v1/me/assessments/:id/attempts
   *
   * Start a new attempt. Server sets started_at + time_expires_at.
   * Returns shuffled questions WITHOUT answer keys or isCorrect flags.
   *
   * Errors:
   *   - 422 ATTEMPTS_EXHAUSTED (no remaining attempts)
   *   - 422 ATTEMPT_IN_PROGRESS (unsubmitted non-expired attempt exists)
   *
   * Permission: attempts.take (scope: own).
   */
  async startAttempt(
    assessmentId: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<AttemptInProgress> {
    return this.client.request<AttemptInProgress>(
      "POST",
      `/api/v1/me/assessments/${assessmentId}/attempts`,
      { body: {}, idempotencyKey },
    );
  }

  /**
   * PUT /api/v1/me/attempts/:id
   *
   * Submit answers for an in-progress attempt.
   * - Server checks time_expires_at (422 ATTEMPT_EXPIRED if late).
   * - MCQ auto-graded server-side against answer key (never revealed to student).
   * - Descriptive: passed=null until faculty grades.
   * - IDEMPOTENT: re-submit returns 200 with cached result (no double-grade).
   *
   * Permission: attempts.take (scope: own).
   */
  async submitAttempt(
    attemptId: string,
    body: SubmitAttemptRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<AttemptResult> {
    return this.client.request<AttemptResult>(
      "PUT",
      `/api/v1/me/attempts/${attemptId}`,
      { body, idempotencyKey },
    );
  }

  /**
   * GET /api/v1/me/attempts/:id
   *
   * Get attempt detail (own only — cross-student IDOR→404).
   * In-progress: questionResults=null.
   * Post-submit: includes per-question correctness for MCQ (no answer key revealed).
   * Permission: attempts.view (scope: own).
   */
  async getAttempt(attemptId: string): Promise<AttemptResult> {
    return this.client.request<AttemptResult>("GET", `/api/v1/me/attempts/${attemptId}`);
  }

  /**
   * PATCH /api/v1/me/attempts/:id/flag
   *
   * Report a tab-switch or focus-loss event (advisory signal, NOT a hard block).
   * Increments flags.tabSwitchCount on the server. Does NOT terminate the attempt (AC-D6).
   * Permission: attempts.take (scope: own).
   */
  async flagAttempt(attemptId: string, body: FlagAttemptRequest): Promise<AttemptResult> {
    return this.client.request<AttemptResult>(
      "PATCH",
      `/api/v1/me/attempts/${attemptId}/flag`,
      { body },
    );
  }
}
