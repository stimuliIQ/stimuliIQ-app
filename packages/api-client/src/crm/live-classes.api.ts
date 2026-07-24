// Typed live-classes SDK (CRM/staff surface) — Phase 9 Completion, T14/T20
// (docs/plans/phase-9-completion.md). See packages/types/src/live/live-classes.schemas.ts
// for the full contract. LMS/student join lives on `client.lms.liveClasses` (own-scope).

import type {
  CreateLiveClassRequest,
  UpdateLiveClassRequest,
  ListLiveClassesQuery,
  LiveClassSummary,
  LiveClassDetail,
  JoinLiveClassResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LiveClassesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/live-classes */
  async list(query: ListLiveClassesQuery) {
    return this.client.requestPaginated<LiveClassSummary>("GET", `/api/v1/crm/live-classes${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/live-classes/:id */
  async get(id: string): Promise<LiveClassDetail> {
    return this.client.request<LiveClassDetail>("GET", `/api/v1/crm/live-classes/${id}`);
  }

  /** POST /api/v1/crm/live-classes — schedules the DB row + asks the LiveClassProvider adapter to create the remote meeting. */
  async create(body: CreateLiveClassRequest, idempotencyKey: string = crypto.randomUUID()): Promise<LiveClassDetail> {
    return this.client.request<LiveClassDetail>("POST", "/api/v1/crm/live-classes", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/live-classes/:id */
  async update(
    id: string,
    body: UpdateLiveClassRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LiveClassDetail> {
    return this.client.request<LiveClassDetail>("PATCH", `/api/v1/crm/live-classes/${id}`, { body, idempotencyKey });
  }

  /** POST /api/v1/crm/live-classes/:id/cancel */
  async cancel(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<LiveClassDetail> {
    return this.client.request<LiveClassDetail>("POST", `/api/v1/crm/live-classes/${id}/cancel`, {
      body: {},
      idempotencyKey,
    });
  }

  /** POST /api/v1/crm/live-classes/:id/join — host/staff join, mints a short-lived provider join URL. */
  async join(id: string): Promise<JoinLiveClassResponse> {
    return this.client.request<JoinLiveClassResponse>("POST", `/api/v1/crm/live-classes/${id}/join`, { body: {} });
  }
}
