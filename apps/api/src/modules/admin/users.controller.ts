// apps/api/src/modules/admin/users.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). Admin ▸ Users — staff-account
// credential management, mounted at /api/v1/crm/admin/users. Permission keys
// users.view/create/edit/delete are seeded at scope=all for super_admin + admin only
// (prisma/seed.ts "Admin ▸ Users permissions" block).

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
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { Request } from "express";
import type { StaffUser } from "@repo/types";
import {
  ListStaffUsersQuerySchema,
  type ListStaffUsersQuery,
  CreateStaffUserRequestSchema,
  type CreateStaffUserRequest,
  UpdateStaffUserRequestSchema,
  type UpdateStaffUserRequest,
  AdminClearTwoFactorRequestSchema,
  type AdminClearTwoFactorRequest,
  type AdminClearTwoFactorResponse,
  type DeleteStaffUserResponse,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { UsersAdminService } from "./users.service";

@Controller("crm/admin/users")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class UsersAdminController {
  constructor(private readonly usersService: UsersAdminService) {}

  @Get()
  @RequirePermission("users.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListStaffUsersQuerySchema)) query: ListStaffUsersQuery,
  ): Promise<PaginatedResult<StaffUser>> {
    return this.usersService.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("users.view")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<StaffUser> {
    return this.usersService.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("users.create")
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateStaffUserRequestSchema)) body: CreateStaffUserRequest,
    @Req() req: Request,
  ): Promise<StaffUser> {
    return this.usersService.create(user.tenantId, user.id, body, req.ip);
  }

  @Patch(":id")
  @RequirePermission("users.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateStaffUserRequestSchema)) body: UpdateStaffUserRequest,
    @Req() req: Request,
  ): Promise<StaffUser> {
    return this.usersService.update(user.tenantId, user.id, id, body, req.ip);
  }

  /**
   * Admin 2FA rescue — for a user who lost both their authenticator and their inbox.
   * `twofa.reset`, NOT the own-scope `twofa.manage` every role holds (see
   * UsersAdminService.clearTwoFactor). Audit-logged with the mandatory reason.
   */
  @Post(":id/two-factor/clear")
  @HttpCode(200)
  @RequirePermission("twofa.reset")
  async clearTwoFactor(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AdminClearTwoFactorRequestSchema)) body: AdminClearTwoFactorRequest,
    @Req() req: Request,
  ): Promise<AdminClearTwoFactorResponse> {
    return this.usersService.clearTwoFactor(user.tenantId, user.id, id, body.reason, req.ip);
  }

  /** DELETE = deactivate (blocks login, revokes sessions) — never a hard row delete. */
  @Delete(":id")
  @RequirePermission("users.delete")
  async deactivate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<StaffUser> {
    return this.usersService.deactivate(user.tenantId, user.id, id, req.ip);
  }

  /**
   * Remove the account from the CRM for good — a different act from deactivating it, on its
   * own path and its own permission.
   *
   * `users.remove` is seeded for super_admin ALONE, while `users.delete` (deactivate above)
   * is also held by admin. That split is the whole point: an admin can stop someone signing
   * in, but only a super admin can take an account out of the product. Reusing `users.delete`
   * here would silently hand every admin the stronger power.
   */
  @Delete(":id/permanent")
  @RequirePermission("users.remove")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<DeleteStaffUserResponse> {
    await this.usersService.remove(user.tenantId, user.id, id, req.ip);
    return { deleted: true };
  }
}
