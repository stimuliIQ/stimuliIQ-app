// Assignments + Projects + Submissions SDK — Phase 4, Wave 2
// (docs/plans/phase-4.md task #2).
//
// Namespace: client.learning.assignments.*
//
// Endpoints covered:
//   CRM (faculty authoring / grading, assigned-scope):
//     GET  /crm/assignments              → list()
//     POST /crm/assignments              → create()
//     GET  /crm/assignments/:id          → get()
//     PATCH /crm/assignments/:id         → update()
//     DELETE /crm/assignments/:id        → softDelete()
//     GET  /crm/assignments/:id/submissions  → listSubmissions()
//     GET  /crm/submissions/:id          → getSubmission()
//     PATCH /crm/submissions/:id/grade   → gradeSubmission() [AUDITED before/after]
//     GET  /crm/assignments/:id/project  → getProjectCrm()
//
//   LMS (student, own-scope):
//     GET  /me/assignments               → listMine()
//     GET  /me/assignments/:id           → getMine()
//     POST /me/assignments/:id/submit    → submit()
//     POST /me/assignments/:id/milestones/:milestoneId/submit → submitMilestone()
//     GET  /me/assignments/:id/my-submission → getMySubmission()
//     GET  /me/assignments/:id/project   → getMyProject()
//
// SECURITY:
//   - Student can only see/submit their own assignments (IDOR→404 for cross-student).
//   - Faculty grades only assigned-batch submissions (403 for unassigned).
//   - Files in submissions are StorageProvider keys — download URLs are signed.
//   - Grade changes are audited with before/after server-side.

import type {
  AssignmentDetail,
  AssignmentSummary,
  AssignmentListItem,
  AssignmentStudentDetail,
  CreateAssignmentRequest,
  UpdateAssignmentRequest,
  SubmitAssignmentRequest,
  GradeSubmissionRequest,
  SubmissionDetail,
  SubmissionSummary,
  ProjectDetail,
  ListAssignmentsQuery,
  ListSubmissionsQuery,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class AssignmentsApi {
  constructor(private readonly client: ApiClient) {}

  // ─── CRM / faculty authoring ─────────────────────────────────────────────

  /**
   * GET /api/v1/crm/assignments
   * List assignments (assigned-batch scoped for faculty; all for admin).
   * Permission: assignments.view (scope: assigned|all).
   */
  async list(query?: Partial<ListAssignmentsQuery>) {
    return this.client.requestPaginated<AssignmentSummary>(
      "GET",
      `/api/v1/crm/assignments${toQueryString(query ?? {})}`,
    );
  }

  /**
   * POST /api/v1/crm/assignments
   * Create an assignment or project assignment on a lesson.
   * `milestones` only for kind='project'. `isFinal` gates certificate eligibility.
   * Permission: assignments.create (scope: assigned).
   */
  async create(
    body: CreateAssignmentRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<AssignmentDetail> {
    return this.client.request<AssignmentDetail>("POST", "/api/v1/crm/assignments", {
      body,
      idempotencyKey,
    });
  }

  /**
   * GET /api/v1/crm/assignments/:id
   * Full assignment detail including milestones and submission counts.
   * Permission: assignments.view (scope: assigned|all).
   */
  async get(id: string): Promise<AssignmentDetail> {
    return this.client.request<AssignmentDetail>("GET", `/api/v1/crm/assignments/${id}`);
  }

  /**
   * PATCH /api/v1/crm/assignments/:id
   * Partial update. Permission: assignments.edit (scope: assigned).
   */
  async update(
    id: string,
    body: UpdateAssignmentRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<AssignmentDetail> {
    return this.client.request<AssignmentDetail>("PATCH", `/api/v1/crm/assignments/${id}`, {
      body,
      idempotencyKey,
    });
  }

  /**
   * DELETE /api/v1/crm/assignments/:id
   * Soft-delete. Permission: assignments.edit (scope: assigned).
   */
  async softDelete(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<AssignmentDetail> {
    return this.client.request<AssignmentDetail>("DELETE", `/api/v1/crm/assignments/${id}`, {
      idempotencyKey,
    });
  }

  // ─── CRM submission management ───────────────────────────────────────────

  /**
   * GET /api/v1/crm/assignments/:id/submissions
   * Faculty grading queue — only submissions in assigned batches.
   * Permission: submissions.view (scope: assigned).
   */
  async listSubmissions(assignmentId: string, query?: Partial<ListSubmissionsQuery>) {
    return this.client.requestPaginated<SubmissionSummary>(
      "GET",
      `/api/v1/crm/assignments/${assignmentId}/submissions${toQueryString(query ?? {})}`,
    );
  }

  /**
   * GET /api/v1/crm/submissions/:id
   * Submission detail (faculty, assigned-scope). Includes signed file download URLs.
   * Permission: submissions.view (scope: assigned).
   */
  async getSubmission(submissionId: string): Promise<SubmissionDetail> {
    return this.client.request<SubmissionDetail>("GET", `/api/v1/crm/submissions/${submissionId}`);
  }

  /**
   * PATCH /api/v1/crm/submissions/:id/grade
   *
   * Grade a submission. Sets status=graded, populates score/rubric/feedback.
   * AUDITED: writes audit log entry with before/after values (AC-B1, AC-B3).
   * Faculty can only grade assigned-batch submissions (AC-B2); students cannot self-grade (AC-B4).
   *
   * Permission: submissions.grade (scope: assigned).
   */
  async gradeSubmission(
    submissionId: string,
    body: GradeSubmissionRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<SubmissionDetail> {
    return this.client.request<SubmissionDetail>(
      "PATCH",
      `/api/v1/crm/submissions/${submissionId}/grade`,
      { body, idempotencyKey },
    );
  }

  /**
   * GET /api/v1/crm/assignments/:id/project
   * Full project detail with per-milestone review states (faculty assigned-scope).
   * Permission: projects.review (scope: assigned).
   */
  async getProjectCrm(assignmentId: string): Promise<ProjectDetail> {
    return this.client.request<ProjectDetail>(
      "GET",
      `/api/v1/crm/assignments/${assignmentId}/project`,
    );
  }

  // ─── LMS / student (own-scope) ───────────────────────────────────────────

  /**
   * GET /api/v1/me/assignments
   * Student's assignments with derived status (assigned/submitted/graded/overdue).
   * Permission: assignments.view (scope: own).
   */
  async listMine(query?: Partial<ListAssignmentsQuery>) {
    return this.client.requestPaginated<AssignmentListItem>(
      "GET",
      `/api/v1/me/assignments${toQueryString(query ?? {})}`,
    );
  }

  /**
   * GET /api/v1/me/assignments/:id
   * Assignment detail + own submission snapshot.
   * Permission: assignments.view (scope: own). IDOR→404 if not enrolled.
   */
  async getMine(id: string): Promise<AssignmentStudentDetail> {
    return this.client.request<AssignmentStudentDetail>("GET", `/api/v1/me/assignments/${id}`);
  }

  /**
   * POST /api/v1/me/assignments/:id/submit
   *
   * Student submits an assignment. `files` must be StorageProvider keys from the
   * signed-upload flow (POST /storage/upload-url → PUT → include storageKey here).
   *
   * Errors:
   *   - 422 ASSIGNMENT_OVERDUE (past due_at)
   *   - 409 RESUBMIT_NOT_ALLOWED (allow_resubmit=false and submission exists)
   *   - 404 IDOR (assignment not in enrolled program)
   *
   * Permission: submissions.create (scope: own).
   */
  async submit(
    assignmentId: string,
    body: SubmitAssignmentRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<SubmissionDetail> {
    return this.client.request<SubmissionDetail>(
      "POST",
      `/api/v1/me/assignments/${assignmentId}/submit`,
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/me/assignments/:id/milestones/:milestoneId/submit
   *
   * Student submits a project milestone. Same constraints as `submit()`.
   * Permission: submissions.create (scope: own).
   */
  async submitMilestone(
    assignmentId: string,
    milestoneId: string,
    body: SubmitAssignmentRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<SubmissionDetail> {
    return this.client.request<SubmissionDetail>(
      "POST",
      `/api/v1/me/assignments/${assignmentId}/milestones/${milestoneId}/submit`,
      { body, idempotencyKey },
    );
  }

  /**
   * GET /api/v1/me/assignments/:id/my-submission
   *
   * Student's own submission including signed file download URLs, grade, rubric, feedback.
   * Cross-student IDOR→404.
   * Permission: submissions.view (scope: own).
   */
  async getMySubmission(assignmentId: string): Promise<SubmissionDetail> {
    return this.client.request<SubmissionDetail>(
      "GET",
      `/api/v1/me/assignments/${assignmentId}/my-submission`,
    );
  }

  /**
   * GET /api/v1/me/assignments/:id/project
   *
   * Project milestone states for own enrollment (student view).
   * Permission: assignments.view (scope: own).
   */
  async getMyProject(assignmentId: string): Promise<ProjectDetail> {
    return this.client.request<ProjectDetail>(
      "GET",
      `/api/v1/me/assignments/${assignmentId}/project`,
    );
  }
}
