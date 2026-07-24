// apps/api/src/modules/lms/lms.controller.ts
//
// HTTP boundary for the LMS student-facing content + stream-url endpoints.
// (docs/04 §2.1: "controller — HTTP boundary, validates DTO via global Zod pipe, returns DTO")
//
// Mounted at /api/v1/lms (except lesson routes which are at /api/v1/lessons).
// No business logic, no Prisma — all delegated to LmsService.
//
// ─── PERMISSION KEYS (seeded in prisma/seed.ts P3 matrix) ──────────────────
//   GET /me/dashboard               → courses.view    (scope: own)
//   GET /me/enrollments             → courses.view    (scope: own)
//   GET /me/enrollments/:id         → courses.view    (scope: own)
//   GET /me/enrollments/:id/curriculum → courses.view (scope: own)
//   GET /lessons/:id                → lessons.view    (scope: own)
//   GET /lessons/:id/stream-url     → videos.stream   (scope: own)
//
// ─── NOTE on controller split ─────────────────────────────────────────────
//   The "me/*" routes are on LmsController (mounted at "lms").
//   The "lessons/:id" routes are on LessonsController (mounted at "lessons").
//   The webhook is on VideoWebhookController (mounted at "lms/videos/webhook").
//   All share the same LmsModule and LmsService.

import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  MeDashboardResponse,
  MyEnrollmentSummary,
  MyEnrollmentDetail,
  CurriculumResponse,
  LearningPathResponse,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { LmsService } from "./lms.service";
import { ListMyEnrollmentsQuerySchema, type ListMyEnrollmentsQuery } from "./dto";

@Controller("me")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LmsController {
  constructor(private readonly lmsService: LmsService) {}

  // ─── DASHBOARD ─────────────────────────────────────────────────────────

  /**
   * GET /api/v1/me/dashboard
   * Returns the authenticated student's own dashboard data: enrollments, continue-learning,
   * progress rings, upcoming lessons. ALL from the student's own enrollments only.
   * Permission: courses.view (scope: own).
   */
  @Get("dashboard")
  @RequirePermission("courses.view")
  async getDashboard(
    @CurrentUser() user: RequestUser,
  ): Promise<MeDashboardResponse> {
    return this.lmsService.getDashboard(user.id, user.tenantId);
  }

  // ─── LEARNING PATH ─────────────────────────────────────────────────────

  /**
   * GET /api/v1/me/learning-path
   * The student's own "what to do next" — one next-up lesson per active enrollment.
   * Own-scope only (derived from the authenticated user's enrollments).
   * Permission: progress.view (scope: own).
   */
  @Get("learning-path")
  @RequirePermission("progress.view")
  async getLearningPath(
    @CurrentUser() user: RequestUser,
  ): Promise<LearningPathResponse> {
    return this.lmsService.getLearningPath(user.id, user.tenantId);
  }

  // ─── MY ENROLLMENTS ────────────────────────────────────────────────────

  /**
   * GET /api/v1/me/enrollments
   * List the student's own enrollments. Paginated.
   * Permission: courses.view (scope: own).
   */
  @Get("enrollments")
  @RequirePermission("courses.view")
  async listEnrollments(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListMyEnrollmentsQuerySchema)) query: ListMyEnrollmentsQuery,
  ): Promise<PaginatedResult<MyEnrollmentSummary>> {
    return this.lmsService.listEnrollments(user.id, user.tenantId, query);
  }

  /**
   * GET /api/v1/me/enrollments/:id
   * Get a specific enrollment. IDOR: 404 if the enrollment does not belong to this student.
   * Permission: courses.view (scope: own).
   */
  @Get("enrollments/:id")
  @RequirePermission("courses.view")
  async getEnrollmentById(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) enrollmentId: string,
  ): Promise<MyEnrollmentDetail> {
    return this.lmsService.getEnrollmentById(user.id, user.tenantId, enrollmentId);
  }

  /**
   * GET /api/v1/me/enrollments/:id/curriculum
   * Full curriculum tree for an enrolled program.
   * Enrollment-gated: 404 if the enrollment does not belong to this student.
   * Per-lesson progress embedded in tree. No raw video URLs.
   * Permission: courses.view (scope: own).
   */
  @Get("enrollments/:id/curriculum")
  @RequirePermission("courses.view")
  async getCurriculum(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) enrollmentId: string,
  ): Promise<CurriculumResponse> {
    return this.lmsService.getCurriculum(user.id, user.tenantId, enrollmentId);
  }
}
