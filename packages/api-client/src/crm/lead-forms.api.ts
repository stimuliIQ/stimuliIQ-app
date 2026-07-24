// Typed lead-form config SDK (admin) — Phase 9 Completion, T12/T14/T32. Public
// config read lives on `client.public.leadForms.getByKey()`. Actual lead capture
// still goes through `client.public.leads.capture()` (existing P5 endpoint).

import type {
  CreateLeadFormRequest,
  UpdateLeadFormRequest,
  ListLeadFormsQuery,
  LeadForm,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LeadFormsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/lead-forms */
  async list(query: ListLeadFormsQuery) {
    return this.client.requestPaginated<LeadForm>("GET", `/api/v1/crm/lead-forms${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/lead-forms/:id */
  async get(id: string): Promise<LeadForm> {
    return this.client.request<LeadForm>("GET", `/api/v1/crm/lead-forms/${id}`);
  }

  /** POST /api/v1/crm/lead-forms */
  async create(body: CreateLeadFormRequest, idempotencyKey: string = crypto.randomUUID()): Promise<LeadForm> {
    return this.client.request<LeadForm>("POST", "/api/v1/crm/lead-forms", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/lead-forms/:id */
  async update(id: string, body: UpdateLeadFormRequest, idempotencyKey: string = crypto.randomUUID()): Promise<LeadForm> {
    return this.client.request<LeadForm>("PATCH", `/api/v1/crm/lead-forms/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/lead-forms/:id — soft-delete. */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/lead-forms/${id}`, { idempotencyKey });
  }
}
