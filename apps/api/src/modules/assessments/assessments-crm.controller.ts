// apps/api/src/modules/assessments/assessments-crm.controller.ts
//
// CRM HTTP boundary for Assessments + Attempts (faculty/admin authoring + grading).
// Mounted at /api/v1/crm (via global prefix).
//
// Route map (matches @repo/api-client AssessmentsApi SDK + OpenAPI):
//   GET    /crm/assessments                  → listAssessments (assessments.view)
//   POST   /crm/assessments                  → createAssessment (assessments.create)
//   GET    /crm/assessments/:id              → getAssessmentAuthor WITH answer keys
//   PATCH  /crm/assessments/:id              → updateAssessment (assessments.edit)
//   GET    /crm/assessments/:id/attempts     → listAttempts (attempts.view)
//   PUT    /crm/attempts/:id/grade           → gradeAttempt DESCRIPTIVE ONLY (attempts.grade) AUDITED
//
// SECURITY:
//   - @RequirePermission + ScopeInterceptor enforced on every route.
//   - Faculty assigned-scope: only assessments in assigned modules/batches.
//   - IDOR → 404 (not 403) for cross-batch access.
//   - Answer keys returned ONLY on GET /crm/assessments/:id (author view).
//     NEVER returned on student-facing routes.
//   - Manual grade (PUT /crm/attempts/:id/grade) only for descriptive questions.
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
  AssessmentDetailAuthor,
  AssessmentSummary,
  AttemptResult,
  CreateAssessmentRequest,
  GradeAttemptRequest,
  ListAssessmentsQuery,
  UpdateAssessmentRequest,
} from "@repo/types";
import {
  CreateAssessmentRequestSchema,
  GradeAttemptRequestSchema,
  ListAssessmentsQuerySchema,
  UpdateAssessmentRequestSchema,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { requireScopeContext } from "../auth/lib/scope-context";
import { assertAuthoringScope } from "../common-scope/authoring-scope";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { AssessmentsService } from "./assessments.service";

@Controller("crm")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class AssessmentsCrmController {
  constructor(private readonly service: AssessmentsService) {}

  // ─── ASSESSMENTS ──────────────────────────────────────────────────────────

  /**
   * GET /api/v1/crm/assessments
   * List assessments. Faculty: assigned batches only. Admin: all.
   * Permission: assessments.view
   * NOTE: returns AssessmentSummary — NO questions, NO answer keys.
   */
  @Get("assessments")
  @RequirePermission("assessments.view")
  async listAssessments(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListAssessmentsQuerySchema)) query: ListAssessmentsQuery,
  ): Promise<PaginatedResult<AssessmentSummary>> {
    const scope = assertAuthoringScope("assessments", requireScopeContext().scope);
    return this.service.listAssessments(user.tenantId, query, scope, user.id);
  }

  /**
   * POST /api/v1/crm/assessments
   * Create an assessment + questions.
   * Permission: assessments.create
   * Answer keys are stored SERVER-SIDE — included in the create request body (faculty input)
   * and returned in the author-view response.
   */
  @Post("assessments")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("assessments.create")
  async createAssessment(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateAssessmentRequestSchema)) body: CreateAssessmentRequest,
  ): Promise<AssessmentDetailAuthor> {
    const scope = assertAuthoringScope("assessments", requireScopeContext().scope);
    return this.service.createAssessment(user.id, user.tenantId, body, scope);
  }

  /**
   * GET /api/v1/crm/assessments/:id
   * Full assessment detail WITH answer keys (author/faculty view).
   * WARNING: DO NOT return this DTO to students. Students use GET /me/assessments/:id.
   * Permission: assessments.view
   */
  @Get("assessments/:id")
  @RequirePermission("assessments.view")
  async getAssessmentAuthor(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AssessmentDetailAuthor> {
    const scope = assertAuthoringScope("assessments", requireScopeContext().scope);
    return this.service.getAssessmentAuthor(user.tenantId, id, scope, user.id);
  }

  /**
   * PATCH /api/v1/crm/assessments/:id
   * Update assessment metadata (not questions — use questions sub-resource for that).
   * Permission: assessments.edit
   */
  @Patch("assessments/:id")
  @RequirePermission("assessments.edit")
  async updateAssessment(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateAssessmentRequestSchema)) body: UpdateAssessmentRequest,
  ): Promise<AssessmentDetailAuthor> {
    const scope = assertAuthoringScope("assessments", requireScopeContext().scope);
    return this.service.updateAssessment(user.tenantId, id, body, scope, user.id);
  }

  // ─── ATTEMPT GRADING ──────────────────────────────────────────────────────

  /**
   * PUT /api/v1/crm/attempts/:id/grade
   * Faculty manually grades descriptive questions.
   * Audited with before/after. Only applicable for attempts with descriptive questions.
   * Error: 422 MANUAL_GRADE_NOT_APPLICABLE for MCQ-only attempts.
   * Permission: attempts.grade (scope: assigned)
   */
  @Put("attempts/:id/grade")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("attempts.grade")
  async gradeAttempt(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) attemptId: string,
    @Body(new ZodValidationPipe(GradeAttemptRequestSchema)) body: GradeAttemptRequest,
  ): Promise<AttemptResult> {
    const scope = assertAuthoringScope("assessments", requireScopeContext().scope);
    return this.service.gradeAttempt(user.id, user.tenantId, attemptId, body, scope);
  }
}
