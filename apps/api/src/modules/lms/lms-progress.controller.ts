// apps/api/src/modules/lms/lms-progress.controller.ts
//
// HTTP boundary for LMS progress endpoints (docs/04 §2.1).
// Wave 4b: PUT /me/lessons/:id/progress, POST /me/lessons/:id/complete,
//
// Mounted at /api/v1/me (same prefix as LmsController, different class).
//
// ─── PERMISSION KEYS (seeded in prisma/seed.ts P3 matrix) ──────────────────
//   PUT  /me/lessons/:id/progress → progress.edit  (scope: own)
//   POST /me/lessons/:id/complete → progress.edit  (scope: own)
//   GET  /me/progress             → progress.view  (scope: own)
//
// ─── NO BUSINESS LOGIC ────────────────────────────────────────────────────
//   Controller delegates everything to LmsProgressService. It only:
//     - Validates the DTO via the global ZodValidationPipe.
//     - Extracts the Idempotency-Key header for the complete endpoint.
//     - Returns the DTO from the service.
//

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  ProgressResponse,
  MyProgressResponse,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ResultWithMeta } from "../../common/dto/paginated-result";
import { LmsProgressService } from "./lms-progress.service";
import {
  UpdateProgressRequestSchema,
  MarkLessonCompleteRequestSchema,
  type UpdateProgressRequest,
} from "./dto";

@Controller("me")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LmsProgressController {
  constructor(private readonly progressService: LmsProgressService) {}

  // ─── POSITION PING ────────────────────────────────────────────────────────

  /**
   * PUT /api/v1/me/lessons/:id/progress
   *
   * Position ping — called by the player on a throttled onTimeUpdate interval
   * (e.g. every 5-10 s) to report the current playback position.
   *
   * ENROLLMENT-GATED (server-side): the lesson must belong to a program the student
   * is enrolled in. Cross-student writes are blocked by the enrollment gate.
   *
   * Body: { lastPositionS: number } ONLY. The client cannot set status or enrollmentId.
   * Returns: ProgressResponse including the recalculated enrollmentProgressPct.
   *
   * No Idempotency-Key required (upsert semantics — last write wins for position).
   *
   * Permission: progress.edit (scope: own).
   */
  @Put("lessons/:id/progress")
  @RequirePermission("progress.edit")
  @HttpCode(HttpStatus.OK)
  async pingProgress(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) lessonId: string,
    @Body(new ZodValidationPipe(UpdateProgressRequestSchema)) body: UpdateProgressRequest,
  ): Promise<ProgressResponse> {
    return this.progressService.pingProgress(user.id, user.tenantId, lessonId, body);
  }

  // ─── MARK COMPLETE ────────────────────────────────────────────────────────

  /**
   * POST /api/v1/me/lessons/:id/complete
   *
   * Explicit lesson completion action. The server:
   *   1. Sets lesson_progress.status=completed + completed_at=now().
   *   2. Rolls up enrollment.progress_pct (completed/total lessons × 100).
   *   3. Returns the updated progress + rollup.
   *   4. Writes an audit-log row via the audited Prisma client inside $transaction.
   *
   * IDEMPOTENT: replaying this endpoint with the same lessonId is always safe:
   *   - If the lesson is already completed, returns current state, no side-effects.
   *   - The Idempotency-Key header provides belt-and-suspenders HTTP-level idempotency
   *     (docs/04 §2.14). The real idempotency lives in the DB state check + the
   *     lesson_progress partial-unique index.
   *
   * Permission: progress.edit (scope: own).
   */
  @Post("lessons/:id/complete")
  @RequirePermission("progress.edit")
  @HttpCode(HttpStatus.OK)
  async markComplete(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) lessonId: string,
    // Idempotency-Key header — belt-and-suspenders for network retries.
    // The service does NOT store/check this (real idempotency is in DB state).
    // It is extracted here for future Redis-based deduplication if needed.
    @Headers("idempotency-key") _idempotencyKey: string | undefined,
    // Body is empty for this action (lessonId is in the path).
    @Body(new ZodValidationPipe(MarkLessonCompleteRequestSchema)) _body: Record<string, never>,
  ): Promise<ProgressResponse> {
    return this.progressService.markComplete(user.id, user.tenantId, lessonId);
  }

  // ─── PROGRESS ROLLUP (READ) ───────────────────────────────────────────────

  /**
   * GET /api/v1/me/progress
   *
   * Per-program/module completion rollup for all of the student's enrollments.
   * Renders the "My Progress" analytics view (progress rings + module bars).
   *
   * Enrollment-scoped: only returns data for the requesting student's own enrollments.
   * Cross-student access is blocked (userId from JWT, not from query).
   *
   * Permission: progress.view (scope: own).
   */
  @Get("progress")
  @RequirePermission("progress.view")
  async getProgressRollup(
    @CurrentUser() user: RequestUser,
  ): Promise<MyProgressResponse> {
    return this.progressService.getProgressRollup(user.id, user.tenantId);
  }
}
