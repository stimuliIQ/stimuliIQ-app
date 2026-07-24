// LMS Attendance SDK (student read-only view) — Phase 3, Wave 2.
// GET /api/v1/me/attendance → MyAttendanceResponse (paginated list + summaries)
// Frontends must never hand-write fetches (CLAUDE.md §3.2).
//
// P3 note: only `source=recorded` rows exist. Attendance is created server-side
// as a side-effect of POST /me/lessons/:id/complete — the client NEVER posts
// attendance directly. The student can only READ their own attendance records.

import type { ListMyAttendanceQuery, MyAttendanceResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class AttendanceApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/me/attendance
   *
   * Returns the authenticated student's attendance records (paginated list)
   * plus per-enrollment attendance summary stats (% coverage).
   *
   * In P3, only `source=recorded` rows exist (created server-side on lesson
   * completion). `liveClassId` is always null in P3 responses.
   *
   * The client NEVER writes attendance — it is always a server-side side-effect
   * of lesson completion or (future) live class join.
   */
  async list(query: ListMyAttendanceQuery = { page: 1, pageSize: 20 }): Promise<MyAttendanceResponse> {
    return this.client.request<MyAttendanceResponse>(
      "GET",
      `/api/v1/me/attendance${toQueryString(query)}`,
    );
  }
}
