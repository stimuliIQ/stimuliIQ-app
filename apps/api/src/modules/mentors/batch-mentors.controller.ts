// apps/api/src/modules/mentors/batch-mentors.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/batches/:id/mentors(...) — a SEPARATE controller from
// BatchesController (batches.module.ts), registered in MentorsModule, matching
// @repo/api-client's BatchesApi.listMentors/assignMentor/removeMentor paths (they hang
// off a batch id, api-designer's file header note in crm/batches.api.ts) and the OpenAPI
// paths registered in packages/types/src/openapi/registry.ts exactly. Nest routes to
// whichever controller declares the matching path regardless of module — no conflict with
// BatchesController's own routes (batches CRUD, faculty assignment, roster).

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import type { MentorBatchAssignment, MentorBatchAssignmentList } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { BatchMentorsService } from "./batch-mentors.service";
import { AssignMentorToBatchRequestSchema, type AssignMentorToBatchRequest } from "./dto";

@Controller("crm/batches")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class BatchMentorsController {
  constructor(private readonly batchMentorsService: BatchMentorsService) {}

  /** AC-23: reuses the caller's existing `batches.view` scope — no separate "view" permission. */
  @Get(":id/mentors")
  @RequirePermission("batches.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<MentorBatchAssignmentList> {
    return this.batchMentorsService.list(user.tenantId, user.id, id);
  }

  /** AC-17/AC-29: `mentors.assign` is distinct from `mentors.edit`. */
  @Post(":id/mentors")
  @HttpCode(201)
  @RequirePermission("mentors.assign")
  async assign(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AssignMentorToBatchRequestSchema)) body: AssignMentorToBatchRequest,
  ): Promise<MentorBatchAssignment> {
    return this.batchMentorsService.assign(user.tenantId, user.id, id, body);
  }

  @Delete(":id/mentors/:mentorId")
  @RequirePermission("mentors.assign")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("mentorId", new ParseUUIDPipe()) mentorId: string,
  ): Promise<MentorBatchAssignmentList> {
    return this.batchMentorsService.remove(user.tenantId, user.id, id, mentorId);
  }
}
