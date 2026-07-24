// Gamification SDK — Phase 6, Wave 2 (docs/plans/phase-6.md task #2).
//
// Namespace: client.engagement.gamification.*
//
// Endpoints covered:
//   LMS own-scope (students + faculty):
//     GET  /me/gamification           → getMySummary()
//     PUT  /me/gamification/prefs     → updatePrefs()
//
//   Batch leaderboard (enrollment-scoped):
//     GET  /batches/:id/leaderboard   → getLeaderboard()
//
// SECURITY CONTRACTS (LOCK-D5):
//   1. getMySummary() filters points_ledger + user_badges on user_id = currentUser.id.
//      Student T's data MUST NOT appear in Student S's response (AC-49).
//   2. getLeaderboard():
//      - Returns ONLY students with leaderboard_opt_in = true (AC-50).
//      - Each entry is { rank, displayName, totalPoints, badgeCount } ONLY.
//      - NO email, phone, enrollmentId, studentId, userId, or PII (AC-50).
//      - A non-enrolled student requesting a leaderboard → 404 (AC-52).
//      - Opt-out reflected within cache TTL (default 60 s) (AC-51).
//   3. updatePrefs(): userId from session, never from request body.
//      Setting leaderboardOptIn=false removes the student from the leaderboard
//      within cache TTL (AC-51).

import type {
  PointsSummaryDto,
  LeaderboardEntryDto,
  UpdateGamificationPrefsDto,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class GamificationApi {
  constructor(private readonly client: ApiClient) {}

  // ─── Own-scope gamification summary ──────────────────────────────────────

  /**
   * GET /api/v1/me/gamification
   *
   * Returns the authenticated user's gamification summary:
   *   - totalPoints: SUM of non-deleted points_ledger.delta rows (incl. negative reversals).
   *   - badges: all earned badges (joined with badge catalog), newest first.
   *   - streak: current streak length + last-activity date + isActive flag.
   *   - leaderboardOptIn + leaderboardDisplayName: opt-in prefs.
   *
   * Own-scope: the backend filters on user_id = currentUser.id (AC-49).
   * Student T's data NEVER appears in Student S's response.
   *
   * Permissions: gamification.view (own).
   */
  async getMySummary(): Promise<PointsSummaryDto> {
    return this.client.request<PointsSummaryDto>("GET", "/api/v1/me/gamification");
  }

  /**
   * PUT /api/v1/me/gamification/prefs
   *
   * Updates the leaderboard opt-in flag and display name alias.
   *
   * SECURITY: userId is ALWAYS derived from session — the body MUST NOT contain userId.
   * The UpdateGamificationPrefsDto schema has no userId field by design.
   *
   * Setting leaderboardOptIn=false removes the student from the batch leaderboard
   * within the cache TTL (default 60 s) (AC-51).
   *
   * @param body - { leaderboardOptIn, leaderboardDisplayName? }
   * @param idempotencyKey - Default: new UUID.
   * Permissions: gamification.prefs.edit (own).
   */
  async updatePrefs(
    body: UpdateGamificationPrefsDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<PointsSummaryDto> {
    return this.client.request<PointsSummaryDto>(
      "PUT",
      "/api/v1/me/gamification/prefs",
      { body, idempotencyKey },
    );
  }

  // ─── Batch leaderboard (enrollment-scoped, PII-minimal) ──────────────────

  /**
   * GET /api/v1/batches/:id/leaderboard
   *
   * Returns the opt-in leaderboard for a batch. LOCK-D5 / AC-50.
   *
   * SECURITY / PRIVACY GUARANTEES:
   *   - Only includes students with leaderboard_opt_in = true.
   *   - Entries are { rank, displayName, totalPoints, badgeCount } ONLY.
   *   - displayName is the student's chosen alias or first name only.
   *     NEVER email, phone, full name, enrollmentId, studentId, or userId.
   *   - This is enforced by the LeaderboardEntryDto compile-time type assertion
   *     in @repo/types/engagement/gamification.schemas.ts.
   *
   * ENROLLMENT-SCOPED IDOR (AC-52):
   *   A non-enrolled student requesting the leaderboard for a batch they are NOT
   *   enrolled in receives 404 (IDOR-safe — batch existence not revealed).
   *
   * CACHE: Results are cached (TTL: 60 s by default). Opt-out takes effect
   * within the cache TTL (AC-51). No stale PII persists beyond TTL.
   *
   * @param batchId - The batch ID to get the leaderboard for.
   * @returns Array of LeaderboardEntryDto entries (no PII beyond displayName).
   *
   * Permissions: gamification.view (enrollment-scoped for students; all for admin/faculty).
   */
  async getLeaderboard(batchId: string): Promise<{
    items: LeaderboardEntryDto[];
    meta: { total: number; ttlSeconds: number };
  }> {
    const envelope = await this.client.request<{
      items?: LeaderboardEntryDto[];
      data?: LeaderboardEntryDto[];
      meta?: { total: number; ttlSeconds: number };
    } & LeaderboardEntryDto[]>("GET", `/api/v1/batches/${batchId}/leaderboard`);

    // The endpoint returns { data: LeaderboardEntryDto[], meta: { total, ttlSeconds } }
    // unwrapped from the envelope by ApiClient.request(). The data field IS the array.
    // We need to handle the envelope-unwrapped shape which is the data array directly.
    // ApiClient.request() returns `data` from the envelope, so envelope is the array.
    const items = Array.isArray(envelope) ? envelope : [];
    return { items, meta: { total: items.length, ttlSeconds: 60 } };
  }
}
