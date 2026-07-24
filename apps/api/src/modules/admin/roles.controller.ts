// apps/api/src/modules/admin/roles.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/admin (roles + permission matrix) — matches @repo/api-client's
// RolesApi paths exactly. Permission keys matched to prisma/seed.ts: roles.view/create/
// edit (super_admin/admin only — scope=all, no branch/assigned/own seeded for roles.*).

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
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";
import type { PermissionMatrix, Role, RolePermissions } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { RolesService } from "./roles.service";
import {
  CreateRoleRequestSchema,
  type CreateRoleRequest,
  UpdateRoleRequestSchema,
  type UpdateRoleRequest,
  ListRolesQuerySchema,
  type ListRolesQuery,
  UpdateRolePermissionsRequestSchema,
  type UpdateRolePermissionsRequest,
} from "./dto";

@Controller("crm/admin")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get("roles")
  @RequirePermission("roles.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListRolesQuerySchema)) query: ListRolesQuery,
  ): Promise<PaginatedResult<Role>> {
    return this.rolesService.list(user.tenantId, query);
  }

  @Post("roles")
  @HttpCode(201)
  @RequirePermission("roles.create")
  @UsePipes(new ZodValidationPipe(CreateRoleRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateRoleRequest): Promise<Role> {
    return this.rolesService.create(user.tenantId, body);
  }

  @Patch("roles/:id")
  @RequirePermission("roles.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateRoleRequestSchema)) body: UpdateRoleRequest,
  ): Promise<Role> {
    return this.rolesService.update(user.tenantId, id, body);
  }

  @Delete("roles/:id")
  @RequirePermission("roles.edit")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<Role> {
    return this.rolesService.remove(user.tenantId, id);
  }

  @Get("permissions")
  @RequirePermission("roles.view")
  async getPermissionCatalog(): Promise<PermissionMatrix> {
    return this.rolesService.getPermissionCatalog();
  }

  @Get("roles/:id/permissions")
  @RequirePermission("roles.view")
  async getRolePermissions(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<RolePermissions> {
    return this.rolesService.getRolePermissions(user.tenantId, id);
  }

  @Put("roles/:id/permissions")
  @RequirePermission("roles.edit")
  async updatePermissions(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateRolePermissionsRequestSchema)) body: UpdateRolePermissionsRequest,
    @Req() req: Request,
  ): Promise<RolePermissions> {
    return this.rolesService.updatePermissions(user.tenantId, user.id, id, body, req.ip);
  }
}
