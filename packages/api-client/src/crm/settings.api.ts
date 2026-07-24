// Typed settings SDK (admin) — Phase 9 Completion, T9/T14/T23. `system` scope is
// platform-wide (Owner/Admin only); `company` scope is the tenant-configurable override.

import type { ListSettingsQuery, Setting, SetSettingRequest, SettingScope } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class SettingsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/settings */
  async list(query: ListSettingsQuery) {
    return this.client.requestPaginated<Setting>("GET", `/api/v1/crm/settings${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/settings/:scope/:key */
  async get(scope: SettingScope, key: string): Promise<Setting> {
    return this.client.request<Setting>("GET", `/api/v1/crm/settings/${scope}/${key}`);
  }

  /** PUT /api/v1/crm/settings/:scope/:key — create-or-update by (scope, key). */
  async set(
    scope: SettingScope,
    key: string,
    body: SetSettingRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<Setting> {
    return this.client.request<Setting>("PUT", `/api/v1/crm/settings/${scope}/${key}`, { body, idempotencyKey });
  }
}
