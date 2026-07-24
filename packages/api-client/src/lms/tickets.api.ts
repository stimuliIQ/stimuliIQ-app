// Typed support-ticket SDK (student/own-scope surface) — Phase 9 Completion, T14/T21.
// Staff-side (all|assigned scope, incl. internal notes) lives on `client.crm.tickets`.

import type {
  ListMyTicketsQuery,
  CreateTicketRequest,
  AddTicketMessageRequest,
  RateTicketRequest,
  TicketSummary,
  TicketDetail,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LmsTicketsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/me/tickets */
  async list(query: ListMyTicketsQuery) {
    return this.client.requestPaginated<TicketSummary>("GET", `/api/v1/me/tickets${toQueryString(query)}`);
  }

  /** GET /api/v1/me/tickets/:id — isInternal messages are filtered out server-side. */
  async get(id: string): Promise<TicketDetail> {
    return this.client.request<TicketDetail>("GET", `/api/v1/me/tickets/${id}`);
  }

  /** POST /api/v1/me/tickets */
  async create(body: CreateTicketRequest, idempotencyKey: string = crypto.randomUUID()): Promise<TicketDetail> {
    return this.client.request<TicketDetail>("POST", "/api/v1/me/tickets", { body, idempotencyKey });
  }

  /** POST /api/v1/me/tickets/:id/messages — isInternal is always forced false server-side. */
  async addMessage(
    id: string,
    body: AddTicketMessageRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<TicketDetail> {
    return this.client.request<TicketDetail>("POST", `/api/v1/me/tickets/${id}/messages`, { body, idempotencyKey });
  }

  /** POST /api/v1/me/tickets/:id/rate — CSAT 1-5, only after resolved|closed. */
  async rate(id: string, body: RateTicketRequest, idempotencyKey: string = crypto.randomUUID()): Promise<TicketDetail> {
    return this.client.request<TicketDetail>("POST", `/api/v1/me/tickets/${id}/rate`, { body, idempotencyKey });
  }
}
