// Typed enrollments SDK — enroll/move/withdraw + list, over /api/v1/crm/enrollments.
// P1 = roster/reporting join only, no commerce (docs/plans/phase-1.md scope note).

import type {
  ListEnrollmentsQuery,
  Enrollment,
  CreateEnrollmentRequest,
  MoveEnrollmentRequest,
  WithdrawEnrollmentRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class EnrollmentsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/enrollments — filter by student/batch/program/status. */
  async list(query: ListEnrollmentsQuery) {
    return this.client.requestPaginated<Enrollment>(
      "GET",
      `/api/v1/crm/enrollments${toQueryString(query)}`,
    );
  }

  /** POST /api/v1/crm/enrollments — enroll a student into a batch; 409 on duplicate (studentId, batchId). */
  async create(body: CreateEnrollmentRequest, idempotencyKey: string = crypto.randomUUID()): Promise<Enrollment> {
    return this.client.request<Enrollment>("POST", "/api/v1/crm/enrollments", { body, idempotencyKey });
  }

  /** POST /api/v1/crm/enrollments/:id/move */
  async move(
    id: string,
    body: MoveEnrollmentRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<Enrollment> {
    return this.client.request<Enrollment>("POST", `/api/v1/crm/enrollments/${id}/move`, {
      body,
      idempotencyKey,
    });
  }

  /** POST /api/v1/crm/enrollments/:id/withdraw — sets status to `dropped`. */
  async withdraw(
    id: string,
    body: WithdrawEnrollmentRequest = {},
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<Enrollment> {
    return this.client.request<Enrollment>("POST", `/api/v1/crm/enrollments/${id}/withdraw`, {
      body,
      idempotencyKey,
    });
  }
}
