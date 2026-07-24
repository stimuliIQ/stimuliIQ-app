// apps/api/src/modules/mentors/batch-completion.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/batches/:id/completion(...) and /api/v1/crm/batches/:id/complete
// — a SEPARATE controller from BatchesController, registered in MentorsModule, matching
// @repo/api-client's BatchesApi.getCompletion/listCompletionStudents/markComplete paths
// and the OpenAPI paths registered in packages/types/src/openapi/registry.ts exactly.

import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import type { BatchCompletionStudentRow, BatchCompletionSummaryDto, MarkBatchCompleteResponse } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { BatchCompletionService } from "./batch-completion.service";
import { ListBatchCompletionStudentsQuerySchema, type ListBatchCompletionStudentsQuery } from "./dto";

@Controller("crm/batches")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class BatchCompletionController {
  constructor(private readonly batchCompletionService: BatchCompletionService) {}

  /** AC-31 through AC-37 — reuses `batches.view` (a Mentor requesting an unassigned batch gets 404, AC-37). */
  @Get(":id/completion")
  @RequirePermission("batches.view")
  async getCompletion(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<BatchCompletionSummaryDto> {
    return this.batchCompletionService.getSummary(user.tenantId, user.id, id);
  }

  /** Paginated per-student breakdown — never an unbounded array (Part 4 edge case). */
  @Get(":id/completion/students")
  @RequirePermission("batches.view")
  async listCompletionStudents(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(ListBatchCompletionStudentsQuerySchema)) query: ListBatchCompletionStudentsQuery,
  ): Promise<PaginatedResult<BatchCompletionStudentRow>> {
    return this.batchCompletionService.listStudents(user.tenantId, user.id, id, query);
  }

  /** AC-38 through AC-45 — `batches.markComplete` (LOCK-5, distinct from `batches.edit`). */
  @Post(":id/complete")
  @HttpCode(200)
  @RequirePermission("batches.markComplete")
  async markComplete(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<MarkBatchCompleteResponse> {
    return this.batchCompletionService.markComplete(user.tenantId, user.id, id);
  }
}
