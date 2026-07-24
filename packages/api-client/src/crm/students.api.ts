// Typed students SDK — GET/POST/PATCH/DELETE/restore over /api/v1/crm/students.
// Frontends must never hand-write fetches (CLAUDE.md §3.2); every shape
// comes from @repo/types.

import type {
  ListStudentsQuery,
  StudentSummary,
  StudentDetail,
  CreateStudentRequest,
  UpdateStudentRequest,
  ResendCredentialsResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class StudentsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/students — search/filter/paginate the student directory. */
  async list(query: ListStudentsQuery) {
    return this.client.requestPaginated<StudentSummary>(
      "GET",
      `/api/v1/crm/students${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/students/:id */
  async get(id: string): Promise<StudentDetail> {
    return this.client.request<StudentDetail>("GET", `/api/v1/crm/students/${id}`);
  }

  /** POST /api/v1/crm/students — creates the backing user + the student profile in one transaction. */
  async create(body: CreateStudentRequest, idempotencyKey: string = crypto.randomUUID()): Promise<StudentDetail> {
    return this.client.request<StudentDetail>("POST", "/api/v1/crm/students", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/students/:id */
  async update(
    id: string,
    body: UpdateStudentRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<StudentDetail> {
    return this.client.request<StudentDetail>("PATCH", `/api/v1/crm/students/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/students/:id — soft-delete. */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<StudentDetail> {
    return this.client.request<StudentDetail>("DELETE", `/api/v1/crm/students/${id}`, { idempotencyKey });
  }

  /** POST /api/v1/crm/students/:id/restore */
  async restore(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<StudentDetail> {
    return this.client.request<StudentDetail>("POST", `/api/v1/crm/students/${id}/restore`, {
      body: {},
      idempotencyKey,
    });
  }

  /**
   * POST /api/v1/crm/students/:id/resend-credentials — rotates the student's LMS
   * password to a fresh temp password, sets `mustChangePassword`, and re-emails the
   * welcome email. Destructive from the student's POV (invalidates their current
   * password immediately) — callers must confirm before firing this.
   */
  async resendCredentials(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ResendCredentialsResponse> {
    return this.client.request<ResendCredentialsResponse>(
      "POST",
      `/api/v1/crm/students/${id}/resend-credentials`,
      { body: {}, idempotencyKey },
    );
  }
}
