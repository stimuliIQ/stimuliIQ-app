// LMS Dashboard SDK — Phase 3, Wave 2 (docs/plans/phase-3.md task #2).
// GET /api/v1/me/dashboard → MeDashboardResponse
// Frontends must never hand-write fetches (CLAUDE.md §3.2).

import type { MeDashboardResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class DashboardApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/me/dashboard
   *
   * Returns the authenticated student's dashboard snapshot:
   * enrollment cards, continue-learning rail (resume last in-progress lesson
   * at last_position_s), per-program progress summary, and upcoming lessons.
   *
   * All data is the STUDENT'S OWN — scope:own enforced server-side.
   * Do NOT call this with another student's session.
   */
  async get(): Promise<MeDashboardResponse> {
    return this.client.request<MeDashboardResponse>("GET", "/api/v1/me/dashboard");
  }
}
