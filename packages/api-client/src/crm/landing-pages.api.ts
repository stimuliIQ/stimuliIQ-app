// Typed landing-pages SDK (admin) — Phase 9 Completion, T12/T14/T33/T40. Public
// render lives on `client.public.landingPages.get()`.

import type {
  CreateLandingPageRequest,
  UpdateLandingPageRequest,
  ListLandingPagesQuery,
  LandingPageSummary,
  LandingPageDetail,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LandingPagesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/landing-pages */
  async list(query: ListLandingPagesQuery) {
    return this.client.requestPaginated<LandingPageSummary>("GET", `/api/v1/crm/landing-pages${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/landing-pages/:id */
  async get(id: string): Promise<LandingPageDetail> {
    return this.client.request<LandingPageDetail>("GET", `/api/v1/crm/landing-pages/${id}`);
  }

  /** POST /api/v1/crm/landing-pages */
  async create(body: CreateLandingPageRequest, idempotencyKey: string = crypto.randomUUID()): Promise<LandingPageDetail> {
    return this.client.request<LandingPageDetail>("POST", "/api/v1/crm/landing-pages", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/landing-pages/:id */
  async update(
    id: string,
    body: UpdateLandingPageRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LandingPageDetail> {
    return this.client.request<LandingPageDetail>("PATCH", `/api/v1/crm/landing-pages/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/landing-pages/:id — soft-delete. */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/landing-pages/${id}`, { idempotencyKey });
  }
}
