// Typed feature-flags SDK (admin) — Phase 9 Completion, T9/T14/T23.

import type { ListFeatureFlagsQuery, FeatureFlag, SetFeatureFlagRequest } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class FeatureFlagsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/feature-flags */
  async list(query: ListFeatureFlagsQuery) {
    return this.client.requestPaginated<FeatureFlag>("GET", `/api/v1/crm/feature-flags${toQueryString(query)}`);
  }

  /** GET /api/v1/crm/feature-flags/:key */
  async get(key: string): Promise<FeatureFlag> {
    return this.client.request<FeatureFlag>("GET", `/api/v1/crm/feature-flags/${key}`);
  }

  /** PUT /api/v1/crm/feature-flags/:key — create-or-update by key. */
  async set(key: string, body: SetFeatureFlagRequest, idempotencyKey: string = crypto.randomUUID()): Promise<FeatureFlag> {
    return this.client.request<FeatureFlag>("PUT", `/api/v1/crm/feature-flags/${key}`, { body, idempotencyKey });
  }
}
