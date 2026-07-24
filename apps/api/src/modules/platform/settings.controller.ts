// apps/api/src/modules/platform/settings.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Mounted at /crm/settings*.

import { Body, Controller, Get, Param, ParseEnumPipe, Put, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { SettingScope as SettingScopeEnum } from "@prisma/client";
import type { Setting } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { SettingsService } from "./settings.service";
import {
  ListSettingsQuerySchema,
  type ListSettingsQuery,
  SetSettingRequestSchema,
  type SetSettingRequest,
  type SettingScope,
} from "./dto";

@Controller("crm/settings")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @RequirePermission("settings.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListSettingsQuerySchema)) query: ListSettingsQuery,
  ): Promise<PaginatedResult<Setting>> {
    return this.service.list(user.tenantId, query);
  }

  @Get(":scope/:key")
  @RequirePermission("settings.view")
  async get(
    @CurrentUser() user: RequestUser,
    @Param("scope", new ParseEnumPipe(SettingScopeEnum)) scope: SettingScope,
    @Param("key") key: string,
  ): Promise<Setting> {
    return this.service.get(user.tenantId, scope, key);
  }

  @Put(":scope/:key")
  @RequirePermission("settings.edit")
  async set(
    @CurrentUser() user: RequestUser,
    @Param("scope", new ParseEnumPipe(SettingScopeEnum)) scope: SettingScope,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(SetSettingRequestSchema)) body: SetSettingRequest,
  ): Promise<Setting> {
    return this.service.set(user.tenantId, scope, key, body);
  }
}
