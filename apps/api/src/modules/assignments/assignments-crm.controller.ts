// apps/api/src/modules/assignments/assignments-crm.controller.ts
//
// CRM HTTP boundary for Assignments + Submissions + Projects (faculty/admin).
// Mounted at /api/v1/crm (via global prefix).
//
// Route map (matches @repo/api-client AssignmentsApi SDK):
//   GET    /crm/assignments                        → listAssignments (assignments.view)
//   POST   /crm/assignments                        → createAssignment (assignments.create)
//   GET    /crm/assignments/:id                    → getAssignment (assignments.view)
//   PATCH  /crm/assignments/:id                    → updateAssignment (assignments.edit)
//   DELETE /crm/assignments/:id                    → softDeleteAssignment (assignments.edit)
//   GET    /crm/assignments/:id/submissions        → listSubmissions (submissions.view)
//   GET    /crm/submissions/:id                    → getSubmission (submissions.view)
//   PATCH  /crm/submissions/:id/grade              → gradeSubmission (submissions.grade) AUDITED
//   GET    /crm/assignments/:id/project            → getProjectCrm (projects.review)
//
// SECURITY:
//   - @RequirePermission + ScopeInterceptor enforced on every route.
//   - Faculty assigned-scope: only assignments/submissions in assigned batches (plan §6 Risk #1).
//   - IDOR → 404 (not 403) for cross-batch access.
//   - Grade changes audited with before/after (AC-B1, AC-B3).
//   - No business logic in this file — all delegated to AssignmentsService.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  AssignmentDetail,
  AssignmentSummary,
  CreateAssignmentRequest,
  GradeSubmissionRequest,
  ListAssignmentsQuery,
  ListSubmissionsQuery,
  ProjectDetail,
  ReturnSubmissionRequest,
  SubmissionDetail,
  SubmissionSummary,
  UpdateAssignmentRequest,
} from "@repo/types";
import {
  CreateAssignmentRequestSchema,
  GradeSubmissionRequestSchema,
  ListAssignmentsQuerySchema,
  ListSubmissionsQuerySchema,
  ReturnSubmissionRequestSchema,
  UpdateAssignmentRequestSchema,
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
import { AssignmentsService } from "./assignments.service";

@Controller("crm")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class AssignmentsCrmController {
  constructor(private readonly service: AssignmentsService) {}

  // ─── ASSIGNMENTS ──────────────────────────────────────────────────────────

  /**
   * GET /api/v1/crm/assignments
   * List assignments. Faculty: assigned batches only. Admin: all.
   * Permission: assignments.view
   */
  @Get("assignments")
  @RequirePermission("assignments.view")
  async listAssignments(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListAssignmentsQuerySchema)) query: ListAssignmentsQuery,
  ): Promise<PaginatedResult<AssignmentSummary>> {
    const scope = assertAuthoringScope("assignments", requireScopeContext().scope);
    return this.service.listAssignments(user.tenantId, query, scope, user.id);
  }

  /**
   * POST /api/v1/crm/assignments
   * Create assignment or project.
   * Permission: assignments.create
   */
  @Post("assignments")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("assignments.create")
  async createAssignment(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateAssignmentRequestSchema)) body: CreateAssignmentRequest,
  ): Promise<AssignmentDetail> {
    const scope = assertAuthoringScope("assignments", requireScopeContext().scope);
    return this.service.createAssignment(user.id, user.tenantId, body, scope);
  }

  /**
   * GET /api/v1/crm/assignments/:id
   * Permission: assignments.view
   */
  @Get("assignments/:id")
  @RequirePermission("assignments.view")
  async getAssignment(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AssignmentDetail> {
    const scope = assertAuthoringScope("assignments", requireScopeContext().scope);
    return this.service.getAssignment(user.tenantId, id, scope, user.id);
  }

  /**
   * PATCH /api/v1/crm/assignments/:id
   * Permission: assignments.edit
   */
  @Patch("assignments/:id")
  @RequirePermission("assignments.edit")
  async updateAssignment(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateAssignmentRequestSchema)) body: UpdateAssignmentRequest,
  ): Promise<AssignmentDetail> {
    const scope = assertAuthoringScope("assignments", requireScopeContext().scope);
    return this.service.updateAssignment(user.tenantId, id, body, scope, user.id);
  }

  /**
   * DELETE /api/v1/crm/assignments/:id
   * Permission: assignments.edit
   */
  @Delete("assignments/:id")
  @RequirePermission("assignments.edit")
  async softDeleteAssignment(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AssignmentDetail> {
    const scope = assertAuthoringScope("assignments", requireScopeContext().scope);
    return this.service.softDeleteAssignment(user.tenantId, id, scope, user.id);
  }

  // ─── SUBMISSIONS ──────────────────────────────────────────────────────────

  /**
   * GET /api/v1/crm/assignments/:id/submissions
   * Faculty grading queue. Permission: submissions.view
   */
  @Get("assignments/:id/submissions")
  @RequirePermission("submissions.view")
  async listSubmissions(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) assignmentId: string,
    @Query(new ZodValidationPipe(ListSubmissionsQuerySchema)) query: ListSubmissionsQuery,
  ): Promise<PaginatedResult<SubmissionSummary>> {
    const scope = assertAuthoringScope("assignments", requireScopeContext().scope);
    return this.service.listSubmissions(user.tenantId, assignmentId, query, scope, user.id);
  }

  /**
   * GET /api/v1/crm/submissions/:id
   * Submission detail (faculty). Permission: submissions.view
   */
  @Get("submissions/:id")
  @RequirePermission("submissions.view")
  async getSubmission(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) submissionId: string,
  ): Promise<SubmissionDetail> {
    const scope = assertAuthoringScope("assignments", requireScopeContext().scope);
    return this.service.getSubmission(user.tenantId, submissionId, scope, user.id);
  }

  /**
   * PATCH /api/v1/crm/submissions/:id/grade
   * Grade a submission. AUDITED with before/after (AC-B1, AC-B3).
   * Permission: submissions.grade
   */
  @Patch("submissions/:id/grade")
  @RequirePermission("submissions.grade")
  async gradeSubmission(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) submissionId: string,
    @Body(new ZodValidationPipe(GradeSubmissionRequestSchema)) body: GradeSubmissionRequest,
  ): Promise<SubmissionDetail> {
    const scope = assertAuthoringScope("assignments", requireScopeContext().scope);
    return this.service.gradeSubmission(user.id, user.tenantId, submissionId, body, scope);
  }

  /**
   * POST /api/v1/crm/submissions/:id/return
   * Send the work back to the student for changes. AUDITED with before/after.
   *
   * `submissions.grade`, the same key grading uses: returning is a review decision, not a
   * lesser one, and anyone trusted to put a permanent score on a student's work is trusted
   * to ask them to redo it. A separate key would only mean a reviewer who can fail someone
   * but not give them another go.
   */
  @Post("submissions/:id/return")
  @RequirePermission("submissions.grade")
  @HttpCode(HttpStatus.OK)
  async returnSubmission(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) submissionId: string,
    @Body(new ZodValidationPipe(ReturnSubmissionRequestSchema)) body: ReturnSubmissionRequest,
  ): Promise<SubmissionDetail> {
    const scope = assertAuthoringScope("assignments", requireScopeContext().scope);
    return this.service.returnSubmission(user.id, user.tenantId, submissionId, body, scope);
  }

  // ─── PROJECTS ─────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/crm/assignments/:id/project
   * Project detail with per-milestone review states.
   * Permission: projects.review
   */
  @Get("assignments/:id/project")
  @RequirePermission("projects.review")
  async getProjectCrm(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) assignmentId: string,
  ): Promise<ProjectDetail> {
    const scope = assertAuthoringScope("assignments", requireScopeContext().scope);
    return this.service.getProjectCrm(user.tenantId, assignmentId, scope, user.id);
  }
}
