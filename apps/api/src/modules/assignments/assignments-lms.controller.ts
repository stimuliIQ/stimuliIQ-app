// apps/api/src/modules/assignments/assignments-lms.controller.ts
//
// LMS HTTP boundary for student-facing assignment + submission endpoints.
// Mounted at /api/v1/me (via controller prefix).
//
// Route map (matches @repo/api-client AssignmentsApi SDK):
//   GET  /me/assignments                                  → listMine (assignments.view, own)
//   GET  /me/assignments/:id                              → getMine (assignments.view, own)
//   POST /me/assignments/:id/submit                       → submit (submissions.create, own)
//   POST /me/assignments/:id/milestones/:mid/submit       → submitMilestone (submissions.create, own)
//   GET  /me/assignments/:id/my-submission                → getMySubmission (submissions.view, own)
//   GET  /me/assignments/:id/project                      → getMyProject (assignments.view, own)
//
// SECURITY:
//   - @RequirePermission + own-scope enforced on every route.
//   - Student can ONLY access their own enrollment's assignments (IDOR → 404).
//   - Files in submissions are StorageProvider keys; download URLs are signed.
//   - No business logic in this file — all delegated to AssignmentsService.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  AssignmentListItem,
  AssignmentStudentDetail,
  ListAssignmentsQuery,
  ProjectDetail,
  SubmissionDetail,
  SubmitAssignmentRequest,
} from "@repo/types";
import { ListAssignmentsQuerySchema, SubmitAssignmentRequestSchema } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { AssignmentsService } from "./assignments.service";

@Controller("me")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class AssignmentsLmsController {
  constructor(private readonly service: AssignmentsService) {}

  /**
   * GET /api/v1/me/assignments
   * List assignments for the student's own enrollments.
   * Permission: assignments.view (scope: own).
   */
  @Get("assignments")
  @RequirePermission("assignments.view")
  async listMine(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListAssignmentsQuerySchema)) query: ListAssignmentsQuery,
  ): Promise<PaginatedResult<AssignmentListItem>> {
    return this.service.listMyAssignments(user.id, user.tenantId, query);
  }

  /**
   * GET /api/v1/me/assignments/:id
   * Assignment detail + own submission snapshot.
   * IDOR → 404 if not enrolled.
   * Permission: assignments.view (scope: own).
   */
  @Get("assignments/:id")
  @RequirePermission("assignments.view")
  async getMine(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) assignmentId: string,
  ): Promise<AssignmentStudentDetail> {
    return this.service.getMyAssignment(user.id, user.tenantId, assignmentId);
  }

  /**
   * POST /api/v1/me/assignments/:id/submit
   * Student submits an assignment (files = StorageProvider keys).
   * Permission: submissions.create (scope: own).
   */
  @Post("assignments/:id/submit")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("submissions.create")
  async submit(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) assignmentId: string,
    @Body(new ZodValidationPipe(SubmitAssignmentRequestSchema)) body: SubmitAssignmentRequest,
  ): Promise<SubmissionDetail> {
    return this.service.submitAssignment(user.id, user.tenantId, assignmentId, body);
  }

  /**
   * POST /api/v1/me/assignments/:id/milestones/:milestoneId/submit
   * Student submits a project milestone.
   * Permission: submissions.create (scope: own).
   */
  @Post("assignments/:id/milestones/:milestoneId/submit")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("submissions.create")
  async submitMilestone(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) assignmentId: string,
    @Param("milestoneId", new ParseUUIDPipe()) milestoneId: string,
    @Body(new ZodValidationPipe(SubmitAssignmentRequestSchema)) body: SubmitAssignmentRequest,
  ): Promise<SubmissionDetail> {
    return this.service.submitMilestone(user.id, user.tenantId, assignmentId, milestoneId, body);
  }

  /**
   * GET /api/v1/me/assignments/:id/my-submission
   * Student's own submission with signed file download URLs, grade, rubric, feedback.
   * IDOR → 404 if not enrolled or no submission.
   * Permission: submissions.view (scope: own).
   */
  @Get("assignments/:id/my-submission")
  @RequirePermission("submissions.view")
  async getMySubmission(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) assignmentId: string,
  ): Promise<SubmissionDetail> {
    return this.service.getMySubmission(user.id, user.tenantId, assignmentId);
  }

  /**
   * GET /api/v1/me/assignments/:id/project
   * Project milestone states for the student's own enrollment.
   * Permission: assignments.view (scope: own).
   */
  @Get("assignments/:id/project")
  @RequirePermission("assignments.view")
  async getMyProject(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) assignmentId: string,
  ): Promise<ProjectDetail> {
    return this.service.getMyProject(user.id, user.tenantId, assignmentId);
  }
}
