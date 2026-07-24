// Typed learning-path SDK (own-scope) — Phase 9 Completion, T14/T35.

import type { LearningPathResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class LearningPathApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/me/learning-path — own recommended next-step sequence across active enrollments. */
  async get(): Promise<LearningPathResponse> {
    return this.client.request<LearningPathResponse>("GET", "/api/v1/me/learning-path");
  }
}
