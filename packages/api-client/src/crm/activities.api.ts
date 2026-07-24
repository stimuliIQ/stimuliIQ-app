// Typed activities SDK — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
// Log activities + complete tasks over /api/v1/crm/activities.
// Activities are LOGGED RECORDS in P2 — whatsapp/email are NOT sent.

import type {
  ActivityDetail,
  ListActivitiesQuery,
  CreateActivityRequest,
  CompleteTaskRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class ActivitiesApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/crm/activities — filter/paginate activities.
   * Use `pendingTasks=true` for the counsellor "today's tasks / due follow-ups" view.
   */
  async list(query: ListActivitiesQuery) {
    return this.client.requestPaginated<ActivityDetail>(
      "GET",
      `/api/v1/crm/activities${toQueryString(query)}`,
    );
  }

  /**
   * POST /api/v1/crm/activities
   *
   * Log an activity against a lead or student (exactly one of leadId/studentId required).
   * The authenticated user is recorded as the actor server-side — NOT sent by the client.
   * `dueAt` creates a follow-up task (SLA entry) for task-type activities.
   * LOGGED ONLY in P2 — no delivery for whatsapp/email types.
   */
  async create(
    body: CreateActivityRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ActivityDetail> {
    return this.client.request<ActivityDetail>("POST", "/api/v1/crm/activities", { body, idempotencyKey });
  }

  /**
   * POST /api/v1/crm/activities/:id/complete
   *
   * Marks a task activity as done (sets done_at). Returns 422 for non-task types.
   */
  async completeTask(
    id: string,
    body: CompleteTaskRequest = {},
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ActivityDetail> {
    return this.client.request<ActivityDetail>(
      "POST",
      `/api/v1/crm/activities/${id}/complete`,
      { body, idempotencyKey },
    );
  }
}
