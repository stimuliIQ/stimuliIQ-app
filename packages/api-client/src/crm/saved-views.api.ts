// Typed CRM saved-views SDK (own-scope) — Phase 9 Completion T30 follow-up (promoted
// from a backend-local schema; see @repo/types crm/saved-views.schemas.ts file header).
//
// Namespace: client.crm.savedViews.*
//
// Authenticated only — no dedicated permission key (a saved view is an opaque,
// per-user named filter-set; the caller must separately hold leads.view/students.view
// to query the underlying data it filters). `list()` returns the caller's FULL
// own-scope set unconditionally — `page`/`pageSize` are accepted for structural
// consistency but not applied server-side today (see the schema's file header).

import type { CreateSavedViewRequest, ListSavedViewsQuery, SavedView } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class SavedViewsApi {
  constructor(private readonly client: ApiClient) {}

  /** POST /api/v1/crm/saved-views */
  async create(body: CreateSavedViewRequest, idempotencyKey: string = crypto.randomUUID()): Promise<SavedView> {
    return this.client.request<SavedView>("POST", "/api/v1/crm/saved-views", { body, idempotencyKey });
  }

  /** GET /api/v1/crm/saved-views — own-scope, not actually paginated server-side (see file header). */
  async list(query: Partial<ListSavedViewsQuery> = {}): Promise<SavedView[]> {
    return this.client.request<SavedView[]>("GET", `/api/v1/crm/saved-views${toQueryString(query)}`);
  }

  /** DELETE /api/v1/crm/saved-views/:id — IDOR->404 on another user's saved view. */
  // 204 No Content — nothing is returned.
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<void> {
    await this.client.request<void>("DELETE", `/api/v1/crm/saved-views/${id}`, { idempotencyKey });
  }
}
