// LMS Enrollments SDK (student view) — Phase 3, Wave 2.
// GET /api/v1/me/enrollments          → MyEnrollmentSummary[] (paginated)
// GET /api/v1/me/enrollments/:id      → MyEnrollmentDetail
// GET /api/v1/me/enrollments/:id/curriculum → CurriculumResponse
// Frontends must never hand-write fetches (CLAUDE.md §3.2).

import type {
  ListMyEnrollmentsQuery,
  MyEnrollmentSummary,
  MyEnrollmentDetail,
  CurriculumResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LmsEnrollmentsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/me/enrollments
   *
   * Offset-paginated list of the authenticated student's own enrollments.
   * Filter by status. Returns enrollment cards (program/batch/progress).
   */
  async list(query: ListMyEnrollmentsQuery = { page: 1, pageSize: 20 }) {
    return this.client.requestPaginated<MyEnrollmentSummary>(
      "GET",
      `/api/v1/me/enrollments${toQueryString(query)}`,
    );
  }

  /**
   * GET /api/v1/me/enrollments/:id
   *
   * Full enrollment detail including batch dates and lesson count breakdown.
   * The enrollment MUST belong to the requesting student (403 otherwise).
   */
  async get(id: string): Promise<MyEnrollmentDetail> {
    return this.client.request<MyEnrollmentDetail>("GET", `/api/v1/me/enrollments/${id}`);
  }

  /**
   * GET /api/v1/me/enrollments/:id/curriculum
   *
   * ENROLLMENT-GATED: the enrollment must belong to the requesting student
   * and have status=active. Returns the full program → modules → lessons tree
   * with per-lesson progress snapshots, locked flags, and module rollups.
   *
   * Lesson content bodies are NOT included — call `lessons.get(lessonId)` for
   * the full detail of a specific lesson.
   *
   * 403 if not enrolled or if the enrollment doesn't belong to this student.
   */
  async getCurriculum(enrollmentId: string): Promise<CurriculumResponse> {
    return this.client.request<CurriculumResponse>(
      "GET",
      `/api/v1/me/enrollments/${enrollmentId}/curriculum`,
    );
  }
}
