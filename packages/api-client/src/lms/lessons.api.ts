// LMS Lessons SDK — Phase 3, Wave 2 (docs/plans/phase-3.md task #2).
// GET /api/v1/lessons/:id           → LessonDetailResponse
// GET /api/v1/lessons/:id/stream-url → StreamUrlResponse
// Frontends must never hand-write fetches (CLAUDE.md §3.2).
//
// *** stream-url SECURITY RULES (frontend MUST follow) ***
// The `getStreamUrl` method returns a SHORT-TTL signed HLS URL that:
//   - Expires at `response.expiresAt` (typically ≤5 min from now).
//   - Is minted per-(user, lesson) — sharing it with another user or session
//     will result in CDN rejection.
//   - Is NOT a raw asset URL. Do NOT construct video source URLs any other way.
// The frontend player MUST:
//   1. Call `getStreamUrl(lessonId)` just before starting playback (not on page load).
//   2. Monitor `expiresAt`; re-call this method before or on expiry.
//   3. NEVER store the `url` in localStorage, Redux, or any persistent cache.
//   4. NEVER log the `url` value.
//   5. Render `response.watermark.text` as a visible per-user overlay on the player.

import type { LessonDetailResponse, StreamUrlResponse, ResourceDownloadResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class LessonsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/lessons/:id
   *
   * Returns full lesson detail: title, type, content body, video metadata
   * (NO raw URL), resource metadata list (P3: metadata only, no download URL),
   * and the student's current progress snapshot.
   *
   * ENROLLMENT GATE: non-preview lessons require an active enrollment in the
   * lesson's program → 403 if not enrolled. Preview lessons are accessible
   * without enrollment.
   *
   * NOTE: This endpoint does NOT return a playable stream URL. For that,
   * call `getStreamUrl(id)` just before starting playback.
   */
  async get(id: string): Promise<LessonDetailResponse> {
    return this.client.request<LessonDetailResponse>("GET", `/api/v1/lessons/${id}`);
  }

  /**
   * GET /api/v1/lessons/:id/stream-url
   *
   * Mints a SHORT-TTL signed HLS stream URL for the lesson.
   *
   * *** THIS IS THE ONLY WAY TO GET A PLAYABLE VIDEO URL ***
   *
   * The server verifies enrollment + RBAC (`videos.stream`, scope:own) before
   * minting. Returns a SHORT-TTL (≤5 min) signed HLS manifest URL plus expiry
   * and watermark metadata. Non-enrolled, non-preview access → 403.
   *
   * CRITICAL USAGE RULES:
   *   - Call this just before playback starts (not on page load or curriculum load).
   *   - Re-call when `response.expiresAt` is reached (set a timer or catch a 403
   *     from the CDN and re-mint immediately).
   *   - NEVER persist `response.url` — it is ephemeral by design.
   *   - NEVER log `response.url`.
   *   - MUST render `response.watermark.text` as a visible overlay on the video.
   *
   * If VideoProvider is unconfigured (no cloud credentials set) → 503. In that
   * case the NoopVideoProvider is active (local/test only) and returns a fake
   * signed URL. The real provider is fail-closed (never emits a raw URL).
   */
  async getStreamUrl(id: string): Promise<StreamUrlResponse> {
    return this.client.request<StreamUrlResponse>("GET", `/api/v1/lessons/${id}/stream-url`);
  }

  /**
   * GET /api/v1/lessons/:lessonId/resources/:resourceId/download-url
   *
   * Mints a short-lived signed GET URL for a lesson resource file (mirrors
   * `client.learning.certificates.getDownloadUrl()`). Fetch-on-click — do NOT
   * cache the returned `downloadUrl`; re-call this method for a fresh link.
   * Enrollment-gated: 404 if not enrolled and the lesson is not preview.
   */
  async getResourceDownloadUrl(lessonId: string, resourceId: string): Promise<ResourceDownloadResponse> {
    return this.client.request<ResourceDownloadResponse>(
      "GET",
      `/api/v1/lessons/${lessonId}/resources/${resourceId}/download-url`,
    );
  }
}
