// Typed global-search SDK (own-scope) — Phase 9 Completion, T14/T29.

import type { GlobalSearchQuery, GlobalSearchResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class SearchApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/me/search — own-scoped lessons/resources/forum threads via tsvector full-text index. */
  async search(query: GlobalSearchQuery): Promise<GlobalSearchResponse> {
    return this.client.request<GlobalSearchResponse>("GET", `/api/v1/me/search${toQueryString(query)}`);
  }
}
