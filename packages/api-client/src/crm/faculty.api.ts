// Typed faculty SDK — GET/POST/PATCH/DELETE/restore over /api/v1/crm/faculty.

import type {
  ListFacultyQuery,
  FacultySummary,
  FacultyDetail,
  CreateFacultyRequest,
  UpdateFacultyRequest,
  FacultyResetPasswordResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class FacultyApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/faculty — filter by branch/expertise. */
  async list(query: ListFacultyQuery) {
    return this.client.requestPaginated<FacultySummary>(
      "GET",
      `/api/v1/crm/faculty${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/faculty/:id — includes assigned-batches view. */
  async get(id: string): Promise<FacultyDetail> {
    return this.client.request<FacultyDetail>("GET", `/api/v1/crm/faculty/${id}`);
  }

  /** POST /api/v1/crm/faculty — creates the backing user + the faculty profile in one transaction. */
  async create(body: CreateFacultyRequest, idempotencyKey: string = crypto.randomUUID()): Promise<FacultyDetail> {
    return this.client.request<FacultyDetail>("POST", "/api/v1/crm/faculty", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/faculty/:id */
  async update(
    id: string,
    body: UpdateFacultyRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<FacultyDetail> {
    return this.client.request<FacultyDetail>("PATCH", `/api/v1/crm/faculty/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/faculty/:id — soft-delete. */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<FacultyDetail> {
    return this.client.request<FacultyDetail>("DELETE", `/api/v1/crm/faculty/${id}`, { idempotencyKey });
  }

  /** POST /api/v1/crm/faculty/:id/restore */
  async restore(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<FacultyDetail> {
    return this.client.request<FacultyDetail>("POST", `/api/v1/crm/faculty/${id}/restore`, {
      body: {},
      idempotencyKey,
    });
  }

  /**
   * POST /api/v1/crm/faculty/:id/reset-password — rotates the faculty member's login to a
   * fresh temp password, forces `mustChangePassword`, revokes their existing sessions, and
   * emails them. Destructive from the faculty member's POV (invalidates their current
   * password immediately) — callers must confirm before firing this.
   */
  async resetPassword(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<FacultyResetPasswordResponse> {
    return this.client.request<FacultyResetPasswordResponse>(
      "POST",
      `/api/v1/crm/faculty/${id}/reset-password`,
      { body: {}, idempotencyKey },
    );
  }
}
