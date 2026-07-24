// Typed support-desk SDK (CRM/staff surface) — Phase 9 Completion, T14/T21
// (docs/plans/phase-9-completion.md). Covers tickets (staff, all|assigned scope),
// canned responses, and admin KB-article CRUD. Student-facing own-scope ticket
// methods live on `client.lms.tickets`.

import type {
  ListTicketsQuery,
  UpdateTicketRequest,
  AddTicketMessageRequest,
  TicketSummary,
  TicketDetail,
  CreateCannedResponseRequest,
  UpdateCannedResponseRequest,
  ListCannedResponsesQuery,
  CannedResponse,
  CreateKbArticleRequest,
  UpdateKbArticleRequest,
  ListKbArticlesQuery,
  KbArticleSummary,
  KbArticleDetail,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class TicketsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/tickets */
  async list(query: ListTicketsQuery) {
    return this.client.requestPaginated<TicketSummary>("GET", `/api/v1/crm/tickets${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/tickets/:id — includes internal-only messages. */
  async get(id: string): Promise<TicketDetail> {
    return this.client.request<TicketDetail>("GET", `/api/v1/crm/tickets/${id}`);
  }

  /** PATCH /api/v1/crm/tickets/:id */
  async update(
    id: string,
    body: UpdateTicketRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<TicketDetail> {
    return this.client.request<TicketDetail>("PATCH", `/api/v1/crm/tickets/${id}`, { body, idempotencyKey });
  }

  /** POST /api/v1/crm/tickets/:id/messages — staff reply or internal-only note. */
  async addMessage(
    id: string,
    body: AddTicketMessageRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<TicketDetail> {
    return this.client.request<TicketDetail>("POST", `/api/v1/crm/tickets/${id}/messages`, { body, idempotencyKey });
  }
}

export class CannedResponsesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/canned-responses */
  async list(query: ListCannedResponsesQuery) {
    return this.client.requestPaginated<CannedResponse>("GET", `/api/v1/crm/canned-responses${toQueryString(query)}`);
  }

  /** POST /api/v1/crm/canned-responses */
  async create(body: CreateCannedResponseRequest, idempotencyKey: string = crypto.randomUUID()): Promise<CannedResponse> {
    return this.client.request<CannedResponse>("POST", "/api/v1/crm/canned-responses", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/canned-responses/:id */
  async update(
    id: string,
    body: UpdateCannedResponseRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CannedResponse> {
    return this.client.request<CannedResponse>("PATCH", `/api/v1/crm/canned-responses/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/canned-responses/:id — soft-delete. */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/canned-responses/${id}`, { idempotencyKey });
  }
}

export class KbArticlesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/kb-articles */
  async list(query: ListKbArticlesQuery) {
    return this.client.requestPaginated<KbArticleSummary>("GET", `/api/v1/crm/kb-articles${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/kb-articles/:id — full row incl. body, for edit-form prefill. */
  async get(id: string): Promise<KbArticleDetail> {
    return this.client.request<KbArticleDetail>("GET", `/api/v1/crm/kb-articles/${id}`);
  }

  /** POST /api/v1/crm/kb-articles */
  async create(body: CreateKbArticleRequest, idempotencyKey: string = crypto.randomUUID()): Promise<KbArticleDetail> {
    return this.client.request<KbArticleDetail>("POST", "/api/v1/crm/kb-articles", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/kb-articles/:id — incl. publish toggle. */
  async update(
    id: string,
    body: UpdateKbArticleRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<KbArticleDetail> {
    return this.client.request<KbArticleDetail>("PATCH", `/api/v1/crm/kb-articles/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/kb-articles/:id — soft-delete. */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/kb-articles/${id}`, { idempotencyKey });
  }
}
