// Typed live-classes SDK (student/own-scope surface) — Phase 9 Completion, T14/T20.
// Staff scheduling lives on `client.crm.liveClasses`.

import type { ListMyLiveClassesQuery, MyLiveClass, JoinLiveClassResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LmsLiveClassesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/me/live-classes — the student's own enrolled-batch sessions. */
  async list(query: ListMyLiveClassesQuery) {
    return this.client.requestPaginated<MyLiveClass>("GET", `/api/v1/me/live-classes${toQueryString(query)}`);
  }

  /** POST /api/v1/me/live-classes/:id/join — IDOR->404 if not enrolled in the batch. */
  async join(id: string): Promise<JoinLiveClassResponse> {
    return this.client.request<JoinLiveClassResponse>("POST", `/api/v1/me/live-classes/${id}/join`, { body: {} });
  }
}
