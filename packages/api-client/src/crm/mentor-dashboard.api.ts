// Mentor-facing dashboard SDK — Phase 8, WS-4 (docs/specs/phase-8-mentor.md).
// GET /api/v1/me/mentor/dashboard → MentorDashboardDto
//
// LOCK-3: the Mentor role logs into the existing `crm` app (not the LMS), via
// a role-aware, simplified dashboard route — this is why the method lives
// under `client.crm.*` (as `client.crm.mentorDashboard.get()`) rather than
// `client.lms.*`, even though the path itself is under `/me/...` like the
// LMS student-facing endpoints.
//
// SCOPE (server-enforced, fail-closed — LOCK-2/Rule M-1/Rule M-4): this
// method takes NO parameters. The caller's own assigned batches are resolved
// entirely from the session server-side, re-checked live on every call
// (never cached from login — AC-49). Frontends must never hand-write fetches
// (CLAUDE.md §3.2).

import type { MentorDashboardDto } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class MentorDashboardApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/me/mentor/dashboard
   *
   * Returns ONLY the authenticated mentor's actively-assigned batches (AC-46),
   * each with the same batch-name/program/status/studentCount/percentComplete
   * summary CRM staff see for the same batch (AC-50). Empty `batches: []` is
   * a valid response for a mentor with zero assignments (AC-51) — not an error.
   */
  async get(): Promise<MentorDashboardDto> {
    return this.client.request<MentorDashboardDto>("GET", "/api/v1/me/mentor/dashboard");
  }
}
