// apps/api/src/modules/platform/feature-flags.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes:
//   FeatureFlagsController       — CRM admin list/get/set (/crm/feature-flags*), RBAC-guarded.
//   FeatureFlagsEvaluateController — any authenticated caller (/feature-flags/evaluate),
//     JwtAuthGuard only, no @RequirePermission (mirrors GET /me — "authentication only").

import { Body, Controller, Get, Param, Put, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import type { EvaluatedFeatureFlags, FeatureFlag } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { FeatureFlagsService } from "./feature-flags.service";
import {
  ListFeatureFlagsQuerySchema,
  type ListFeatureFlagsQuery,
  SetFeatureFlagRequestSchema,
  type SetFeatureFlagRequest,
  EvaluateFeatureFlagsQuerySchema,
  type EvaluateFeatureFlagsQuery,
} from "./dto";

@Controller("crm/feature-flags")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class FeatureFlagsController {
  constructor(private readonly service: FeatureFlagsService) {}

  @Get()
  @RequirePermission("flags.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListFeatureFlagsQuerySchema)) query: ListFeatureFlagsQuery,
  ): Promise<PaginatedResult<FeatureFlag>> {
    return this.service.list(user.tenantId, query);
  }

  @Get(":key")
  @RequirePermission("flags.view")
  async getByKey(@CurrentUser() user: RequestUser, @Param("key") key: string): Promise<FeatureFlag> {
    return this.service.getByKey(user.tenantId, key);
  }

  @Put(":key")
  @RequirePermission("flags.edit")
  async set(
    @CurrentUser() user: RequestUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(SetFeatureFlagRequestSchema)) body: SetFeatureFlagRequest,
  ): Promise<FeatureFlag> {
    return this.service.set(user.tenantId, key, body);
  }
}

@Controller("feature-flags")
@UseGuards(JwtAuthGuard)
export class FeatureFlagsEvaluateController {
  constructor(private readonly service: FeatureFlagsService) {}

  /**
   * GET /api/v1/feature-flags/evaluate?keys=a,b,c — no @RequirePermission: any
   * authenticated caller may evaluate flags to gate UI (never a security boundary,
   * per packages/types/src/platform/feature-flags.schemas.ts file header).
   */
  @Get("evaluate")
  async evaluate(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(EvaluateFeatureFlagsQuerySchema)) query: EvaluateFeatureFlagsQuery,
  ): Promise<EvaluatedFeatureFlags> {
    return this.service.evaluate(user.tenantId, query.keys);
  }
}
