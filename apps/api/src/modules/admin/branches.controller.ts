// apps/api/src/modules/admin/branches.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/admin/branches — matches @repo/api-client's BranchesApi paths
// exactly. Permission keys matched to prisma/seed.ts: branches.view/create/edit
// (super_admin/admin only — scope=all, no branch/assigned/own seeded for branches.*).

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import type { BranchDetail } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { BranchesService } from "./branches.service";
import {
  CreateBranchRequestSchema,
  type CreateBranchRequest,
  UpdateBranchRequestSchema,
  type UpdateBranchRequest,
  ListBranchesQuerySchema,
  type ListBranchesQuery,
} from "./dto";

@Controller("crm/admin/branches")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @RequirePermission("branches.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListBranchesQuerySchema)) query: ListBranchesQuery,
  ): Promise<PaginatedResult<BranchDetail>> {
    return this.branchesService.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("branches.view")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<BranchDetail> {
    return this.branchesService.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("branches.create")
  async create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(CreateBranchRequestSchema)) body: CreateBranchRequest): Promise<BranchDetail> {
    return this.branchesService.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("branches.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateBranchRequestSchema)) body: UpdateBranchRequest,
  ): Promise<BranchDetail> {
    return this.branchesService.update(user.tenantId, id, body);
  }
}
