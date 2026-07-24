// apps/api/src/modules/assessments/assessments-lms.controller.ts
//
// LMS HTTP boundary for student-facing assessment + attempt endpoints.
// Mounted at /api/v1/me (via controller prefix).
//
// Route map (matches @repo/api-client AssessmentsApi SDK + OpenAPI):
//   GET   /me/assessments             → listMyAssessments (assessments.view, own)
//   GET   /me/assessments/:id         → getMyAssessment (assessments.view, own)
//   POST  /me/assessments/:id/attempts → startAttempt (attempts.take, own)
//   PUT   /me/attempts/:id            → submitAttempt (attempts.take, own)
//   GET   /me/attempts/:id            → getMyAttempt (attempts.view, own)
//   PATCH /me/attempts/:id/flag       → flagAttempt (attempts.take, own)
//
// SECURITY:
//   - @RequirePermission + own-scope enforced on every route.
//   - IDOR → 404: student can ONLY access their own enrollment's attempts.
//   - ANSWER KEY: NEVER in any response from this controller (AC-J9, AC-D2).
//   - TIME-BOX: server enforces expiry at submit time — client timer is advisory.
//   - No business logic here — all delegated to AssessmentsService.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  AssessmentDetailPublic,
  AttemptInProgress,
  AttemptResult,
  FlagAttemptRequest,
  ListAssessmentsQuery,
  SubmitAttemptRequest,
} from "@repo/types";
import {
  FlagAttemptRequestSchema,
  ListAssessmentsQuerySchema,
  StartAttemptRequestSchema,
  SubmitAttemptRequestSchema,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { AssessmentsService } from "./assessments.service";

@Controller("me")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class AssessmentsLmsController {
  constructor(private readonly service: AssessmentsService) {}

  /**
   * GET /api/v1/me/assessments
   * List assessments for the student's own enrollments.
   * Returns AssessmentDetailPublic — NO questions, NO answer keys.
   * Permission: assessments.view (scope: own).
   */
  @Get("assessments")
  @RequirePermission("assessments.view")
  async listMyAssessments(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListAssessmentsQuerySchema)) query: ListAssessmentsQuery,
  ): Promise<PaginatedResult<AssessmentDetailPublic>> {
    return this.service.listMyAssessments(user.id, user.tenantId, query);
  }

  /**
   * GET /api/v1/me/assessments/:id
   * Student-facing assessment detail — NO questions, NO answer keys (AC-D2, AC-J9).
   * Questions are delivered only when an attempt is started (POST /me/assessments/:id/attempts).
   * IDOR → 404 if not enrolled in the assessment's program.
   * Permission: assessments.view (scope: own).
   */
  @Get("assessments/:id")
  @RequirePermission("assessments.view")
  async getMyAssessment(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) assessmentId: string,
  ): Promise<AssessmentDetailPublic> {
    return this.service.getMyAssessment(user.id, user.tenantId, assessmentId);
  }

  /**
   * POST /api/v1/me/assessments/:id/attempts
   * Start a new attempt. Server sets started_at, time_expires_at, attempt_no.
   * Returns AttemptInProgress: attempt metadata + shuffled questions WITHOUT answer keys.
   * Enforces attempts_allowed and ATTEMPT_IN_PROGRESS.
   * Permission: attempts.take (scope: own).
   */
  @Post("assessments/:id/attempts")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("attempts.take")
  async startAttempt(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) assessmentId: string,
    @Body(new ZodValidationPipe(StartAttemptRequestSchema)) _body: Record<string, never>,
  ): Promise<AttemptInProgress> {
    void _body; // empty body per StartAttemptRequestSchema
    return this.service.startAttempt(user.id, user.tenantId, assessmentId);
  }

  /**
   * PUT /api/v1/me/attempts/:id
   * Submit answers for an in-progress attempt.
   * Server-side: time-box check, MCQ auto-grade, idempotent on re-submit.
   * Returns AttemptResult with per-question correctness (MCQ) — answer key NEVER revealed.
   * Permission: attempts.take (scope: own).
   */
  @Put("attempts/:id")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("attempts.take")
  async submitAttempt(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) attemptId: string,
    @Body(new ZodValidationPipe(SubmitAttemptRequestSchema)) body: SubmitAttemptRequest,
  ): Promise<AttemptResult> {
    return this.service.submitAttempt(user.id, user.tenantId, attemptId, body);
  }

  /**
   * GET /api/v1/me/attempts/:id
   * Retrieve the student's own attempt result (own-scope IDOR check).
   * For in-progress attempts: questionResults is null.
   * For submitted attempts: MCQ per-question correctness is included.
   * Permission: attempts.view (scope: own).
   */
  @Get("attempts/:id")
  @RequirePermission("attempts.view")
  async getMyAttempt(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) attemptId: string,
  ): Promise<AttemptResult> {
    return this.service.getMyAttempt(user.id, user.tenantId, attemptId);
  }

  /**
   * PATCH /api/v1/me/attempts/:id/flag
   * Record a tab-switch or focus-loss event (AC-D6).
   * Does NOT auto-submit or terminate the attempt (basics anti-cheat, P4 LOCK-1).
   * Increments attempts.flags.tabSwitchCount on the server.
   * Permission: attempts.take (scope: own, must be attempt owner).
   */
  @Patch("attempts/:id/flag")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("attempts.take")
  async flagAttempt(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) attemptId: string,
    @Body(new ZodValidationPipe(FlagAttemptRequestSchema)) body: FlagAttemptRequest,
  ): Promise<AttemptResult> {
    return this.service.flagAttempt(user.id, user.tenantId, attemptId, body);
  }
}
