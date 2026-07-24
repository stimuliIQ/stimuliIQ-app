// LMS Progress SDK — Phase 3, Wave 2 (docs/plans/phase-3.md task #2).
// PUT  /api/v1/me/lessons/:id/progress → ProgressResponse  (position ping)
// POST /api/v1/me/lessons/:id/complete → ProgressResponse  (mark complete)
// GET  /api/v1/me/progress             → MyProgressResponse (rollup)
// Frontends must never hand-write fetches (CLAUDE.md §3.2).

import type {
  UpdateProgressRequest,
  MarkLessonCompleteRequest,
  ProgressResponse,
  MyProgressResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class ProgressApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * PUT /api/v1/me/lessons/:id/progress — position ping.
   *
   * Reports the current playback position for resume-where-you-left-off.
   * Call this on a throttled onTimeUpdate interval (e.g. every 5–10 s) and
   * on pause/seek. The server upserts lesson_progress by (enrollment_id, lesson_id).
   *
   * ENROLLMENT-SCOPED: the lesson must belong to a program the student is
   * enrolled in. The student cannot write another student's progress.
   *
   * Does NOT mark the lesson complete — use `complete(id)` for that.
   *
   * No Idempotency-Key required (upsert semantics: last write wins).
   * Returns the updated progress row + the recalculated enrollment progressPct
   * for optimistic progress ring updates without a separate GET /me/progress call.
   */
  async ping(id: string, body: UpdateProgressRequest): Promise<ProgressResponse> {
    return this.client.request<ProgressResponse>("PUT", `/api/v1/me/lessons/${id}/progress`, {
      body,
    });
  }

  /**
   * POST /api/v1/me/lessons/:id/complete — mark lesson as complete.
   *
   * Explicitly marks the lesson completed. The server:
   *   1. Sets lesson_progress.status=completed + completed_at=now().
   *   2. Rolls up enrollment.progress_pct.
   *   3. Idempotently creates one attendance row (source=recorded) — replay is a no-op.
   *   4. Writes an audit-log row.
   *
   * IDEMPOTENT: replaying with the same Idempotency-Key returns the cached
   * ProgressResponse without double-counting attendance.
   *
   * ENROLLMENT-SCOPED: the student must be enrolled in the lesson's program.
   *
   * `idempotencyKey` defaults to a new UUID (docs/04 §2.14 — required on unsafe mutations).
   * Pass your own key to safely retry the same logical completion (e.g. on network failure).
   */
  async complete(
    id: string,
    body: MarkLessonCompleteRequest = {},
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ProgressResponse> {
    return this.client.request<ProgressResponse>("POST", `/api/v1/me/lessons/${id}/complete`, {
      body,
      idempotencyKey,
    });
  }

  /**
   * GET /api/v1/me/progress — per-program/module rollup.
   *
   * Returns completion percentages + lesson counts for all of the student's
   * active enrollments, with per-module breakdown. Used to render the My
   * Progress analytics view (progress rings + module bars, docs/02 §7.10).
   */
  async getRollup(): Promise<MyProgressResponse> {
    return this.client.request<MyProgressResponse>("GET", "/api/v1/me/progress");
  }
}
