// Typed batches SDK — CRUD + assign-faculty + roster, over /api/v1/crm/batches.
//
// Phase 8 (docs/specs/phase-8-mentor.md, WS-2/WS-3): mentor-assignment,
// internship-completion rollup, and the active→completed mark-complete
// transition are all path-scoped under a batch id, so they live here
// alongside assignFaculty/getRoster rather than on MentorsApi. See
// packages/types/src/crm/mentors.schemas.ts for the full contract.

import type {
  ListBatchesQuery,
  BatchSummary,
  BatchDetail,
  BatchRoster,
  CreateBatchRequest,
  UpdateBatchRequest,
  AssignBatchFacultyRequest,
  MentorBatchAssignment,
  MentorBatchAssignmentList,
  AssignMentorToBatchRequest,
  BatchCompletionSummaryDto,
  BatchCompletionStudentRow,
  ListBatchCompletionStudentsQuery,
  MarkBatchCompleteRequest,
  MarkBatchCompleteResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class BatchesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/batches — filter by program/branch/faculty/status. */
  async list(query: ListBatchesQuery) {
    return this.client.requestPaginated<BatchSummary>(
      "GET",
      `/api/v1/crm/batches${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/batches/:id */
  async get(id: string): Promise<BatchDetail> {
    return this.client.request<BatchDetail>("GET", `/api/v1/crm/batches/${id}`);
  }

  /** POST /api/v1/crm/batches */
  async create(body: CreateBatchRequest, idempotencyKey: string = crypto.randomUUID()): Promise<BatchDetail> {
    return this.client.request<BatchDetail>("POST", "/api/v1/crm/batches", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/batches/:id */
  async update(
    id: string,
    body: UpdateBatchRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<BatchDetail> {
    return this.client.request<BatchDetail>("PATCH", `/api/v1/crm/batches/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/batches/:id — soft-delete. */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<BatchDetail> {
    return this.client.request<BatchDetail>("DELETE", `/api/v1/crm/batches/${id}`, { idempotencyKey });
  }

  /** POST /api/v1/crm/batches/:id/restore */
  async restore(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<BatchDetail> {
    return this.client.request<BatchDetail>("POST", `/api/v1/crm/batches/${id}/restore`, {
      body: {},
      idempotencyKey,
    });
  }

  /** POST /api/v1/crm/batches/:id/faculty — assign (or pass `facultyId: null` to unassign). */
  async assignFaculty(
    id: string,
    body: AssignBatchFacultyRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<BatchDetail> {
    return this.client.request<BatchDetail>("POST", `/api/v1/crm/batches/${id}/faculty`, {
      body,
      idempotencyKey,
    });
  }

  /** GET /api/v1/crm/batches/:id/roster — enrolled students (active + completed). */
  async getRoster(id: string): Promise<BatchRoster> {
    return this.client.request<BatchRoster>("GET", `/api/v1/crm/batches/${id}/roster`);
  }

  // ── Phase 8: mentor assignment (WS-2) ─────────────────────────────────────

  /** GET /api/v1/crm/batches/:id/mentors — reuses the caller's batches.view scope (AC-23). */
  async listMentors(id: string): Promise<MentorBatchAssignmentList> {
    return this.client.request<MentorBatchAssignmentList>("GET", `/api/v1/crm/batches/${id}/mentors`);
  }

  /**
   * POST /api/v1/crm/batches/:id/mentors — assigns a mentor, OR updates the
   * `isLead` flag on an already-active assignment (see
   * AssignMentorToBatchRequestSchema's doc comment in @repo/types for the
   * full decision tree). Requires `mentors.assign` (distinct from
   * `mentors.edit`).
   */
  async assignMentor(
    id: string,
    body: AssignMentorToBatchRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<MentorBatchAssignment> {
    return this.client.request<MentorBatchAssignment>("POST", `/api/v1/crm/batches/${id}/mentors`, {
      body,
      idempotencyKey,
    });
  }

  /** DELETE /api/v1/crm/batches/:id/mentors/:mentorId — soft-unassign; returns the batch's updated mentor list. */
  async removeMentor(
    id: string,
    mentorId: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<MentorBatchAssignmentList> {
    return this.client.request<MentorBatchAssignmentList>(
      "DELETE",
      `/api/v1/crm/batches/${id}/mentors/${mentorId}`,
      { idempotencyKey },
    );
  }

  // ── Phase 8: internship-completion rollup + mark-complete (WS-3) ─────────

  /**
   * GET /api/v1/crm/batches/:id/completion — batch-level headcounts + %,
   * LIVE-computed from enrollments/lesson_progress/submissions/attempts/
   * assessments/assignments/certificates (LOCK-4 — never a parallel progress
   * table). A Mentor requesting a batch they are not assigned to gets 404.
   */
  async getCompletion(id: string): Promise<BatchCompletionSummaryDto> {
    return this.client.request<BatchCompletionSummaryDto>("GET", `/api/v1/crm/batches/${id}/completion`);
  }

  /** GET /api/v1/crm/batches/:id/completion/students — paginated per-student breakdown (never unbounded). */
  async listCompletionStudents(id: string, query: ListBatchCompletionStudentsQuery) {
    return this.client.requestPaginated<BatchCompletionStudentRow>(
      "GET",
      `/api/v1/crm/batches/${id}/completion/students${toQueryString(query)}`,
    );
  }

  /**
   * POST /api/v1/crm/batches/:id/complete — active→completed transition.
   * Valid only from `status='active'` (422 BATCH_NOT_ACTIVE otherwise; 409
   * ALREADY_COMPLETED on replay — idempotent no-op). The response's
   * `summary` is the rollup AT THE MOMENT OF TRANSITION — informational
   * only, it never gates this call (Rule M-2/AC-41).
   */
  async markComplete(
    id: string,
    body: MarkBatchCompleteRequest = {},
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<MarkBatchCompleteResponse> {
    return this.client.request<MarkBatchCompleteResponse>("POST", `/api/v1/crm/batches/${id}/complete`, {
      body,
      idempotencyKey,
    });
  }
}
