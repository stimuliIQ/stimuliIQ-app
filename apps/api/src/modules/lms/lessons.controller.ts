// apps/api/src/modules/lms/lessons.controller.ts
//
// HTTP boundary for the lesson-detail and stream-url endpoints.
// Mounted at /api/v1/lessons.
//
// ─── PERMISSION KEYS ──────────────────────────────────────────────────────
//   GET /lessons/:id             → lessons.view  (scope: own)
//   GET /lessons/:id/stream-url  → videos.stream (scope: own) — SECURITY CRITICAL
//
// ─── STREAM-URL SECURITY NOTES ────────────────────────────────────────────
//   - The stream-url endpoint is the sharpest security edge in the LMS.
//   - It MUST NOT be called until the service has verified:
//     1. Active enrollment OR is_preview
//     2. videos.stream RBAC permission (own scope) — enforced by @RequirePermission
//     3. Video status == "ready"
//   - The response NEVER contains the provider_asset_id or any raw/unsigned URL.
//   - The URL in the response is a short-TTL signed HLS manifest URL.
//   - The client MUST NOT cache this URL.

import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { LessonDetailResponse, StreamUrlResponse, ResourceDownloadResponse } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { LmsService } from "./lms.service";

@Controller("lessons")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LessonsController {
  constructor(private readonly lmsService: LmsService) {}

  /**
   * GET /api/v1/lessons/:id
   * Lesson detail: title, type, content, video meta (no raw URL), resources (metadata only),
   * student's progress, prev/next lesson navigation.
   *
   * ENROLLMENT-GATED: non-preview lessons require an active enrollment in the program.
   * Preview lessons (is_preview=true) are accessible without enrollment.
   * Returns 404 for non-enrolled access (no existence disclosure).
   *
   * Permission: lessons.view (scope: own).
   */
  @Get(":id")
  @RequirePermission("lessons.view")
  async getLessonDetail(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) lessonId: string,
  ): Promise<LessonDetailResponse> {
    return this.lmsService.getLessonDetail(user.id, user.tenantId, lessonId);
  }

  /**
   * GET /api/v1/lessons/:id/stream-url
   *
   * *** THE SECURITY-CRITICAL ENDPOINT ***
   *
   * Mints a SHORT-TTL (≤5 min), PER-USER signed HLS manifest URL.
   * Gate: enrollment OR is_preview → videos.status == "ready" → mint via VideoProvider.
   * Returns: { url (signed HLS), expiresAt, provider, watermark: { text, studentId } }
   *
   * NEVER returns: provider_asset_id, raw manifest URL, long-lived token, signing secret.
   *
   * If VideoProvider keys are unconfigured → 503 (fail-closed; never a raw URL).
   * Every call writes an audit_log row (action="video.stream_url_minted").
   *
   * The client MUST:
   *   - Call this endpoint just before starting/resuming playback (not on page load).
   *   - Re-call on expiry (before or after `expiresAt`).
   *   - NEVER store `url` in localStorage/Redux/any persistent cache.
   *   - NEVER log the `url` value.
   *
   * Permission: videos.stream (scope: own).
   */
  @Get(":id/stream-url")
  @RequirePermission("videos.stream")
  async getStreamUrl(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) lessonId: string,
  ): Promise<StreamUrlResponse> {
    return this.lmsService.mintStreamUrl(user.id, user.tenantId, lessonId);
  }

  /**
   * GET /api/v1/lessons/:lessonId/resources/:resourceId/download-url
   *
   * Mints a short-lived signed GET URL for a lesson resource file (mirrors the
   * certificate signed-download pattern). Enrollment-gated: same gate as lesson
   * detail / stream-url. NEVER returns a raw S3/R2 bucket URL or storage key.
   *
   * Permission: lessons.view (scope: own).
   */
  @Get(":lessonId/resources/:resourceId/download-url")
  @RequirePermission("lessons.view")
  async getResourceDownloadUrl(
    @CurrentUser() user: RequestUser,
    @Param("lessonId", new ParseUUIDPipe()) lessonId: string,
    @Param("resourceId", new ParseUUIDPipe()) resourceId: string,
  ): Promise<ResourceDownloadResponse> {
    return this.lmsService.getResourceDownloadUrl(user.id, user.tenantId, lessonId, resourceId);
  }
}
