// apps/api/src/modules/batches/batches.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/batches (matches @repo/api-client's BatchesApi paths exactly).
// Permission keys matched to prisma/seed.ts: batches.view/create/edit/delete.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import type { BatchDetail, BatchRoster } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { BatchesService } from "./batches.service";
import {
  CreateBatchRequestSchema,
  type CreateBatchRequest,
  UpdateBatchRequestSchema,
  type UpdateBatchRequest,
  ListBatchesQuerySchema,
  type ListBatchesQuery,
  AssignBatchFacultyRequestSchema,
  type AssignBatchFacultyRequest,
  type BatchSummary,
} from "./dto";

@Controller("crm/batches")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Get()
  @RequirePermission("batches.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListBatchesQuerySchema)) query: ListBatchesQuery,
  ): Promise<PaginatedResult<BatchSummary>> {
    return this.batchesService.list(user.tenantId, user.id, query);
  }

  @Get(":id")
  @RequirePermission("batches.view")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<BatchDetail> {
    return this.batchesService.getById(user.tenantId, user.id, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("batches.create")
  @UsePipes(new ZodValidationPipe(CreateBatchRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateBatchRequest): Promise<BatchDetail> {
    return this.batchesService.create(user.tenantId, user.id, body);
  }

  @Patch(":id")
  @RequirePermission("batches.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateBatchRequestSchema)) body: UpdateBatchRequest,
  ): Promise<BatchDetail> {
    return this.batchesService.update(user.tenantId, user.id, id, body);
  }

  @Delete(":id")
  @RequirePermission("batches.delete")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<BatchDetail> {
    return this.batchesService.softDelete(user.tenantId, user.id, id);
  }

  @Post(":id/restore")
  @HttpCode(200)
  @RequirePermission("batches.edit")
  async restore(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<BatchDetail> {
    return this.batchesService.restore(user.tenantId, user.id, id);
  }

  @Post(":id/faculty")
  @RequirePermission("batches.edit")
  async assignFaculty(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AssignBatchFacultyRequestSchema)) body: AssignBatchFacultyRequest,
  ): Promise<BatchDetail> {
    return this.batchesService.assignFaculty(user.tenantId, user.id, id, body);
  }

  @Get(":id/roster")
  @RequirePermission("batches.view")
  async roster(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<BatchRoster> {
    return this.batchesService.roster(user.tenantId, user.id, id);
  }
}
