// apps/api/src/modules/live-classes/my-live-classes.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Mounted at /api/v1/me/live-classes — the
// student/faculty/mentor-facing read + join surface. Reuses the SAME LiveClassesService
// (and the SAME liveclass.view/liveclass.join permission keys) as the CRM controller — the
// PermissionsGuard resolves whichever scope the caller's role is granted for that key
// (own for student, assigned for faculty/mentor, all/branch for staff), independent of
// which controller/route matched.

import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import type { JoinLiveClassResponse } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { LiveClassesService } from "./live-classes.service";
import { ListMyLiveClassesQuerySchema, type ListMyLiveClassesQuery, type MyLiveClass } from "./dto";

@Controller("me/live-classes")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class MyLiveClassesController {
  constructor(private readonly service: LiveClassesService) {}

  @Get()
  @RequirePermission("liveclass.view")
  async listMine(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListMyLiveClassesQuerySchema)) query: ListMyLiveClassesQuery,
  ): Promise<PaginatedResult<MyLiveClass>> {
    return this.service.listMine(user.tenantId, user.id, query);
  }

  @Post(":id/join")
  @HttpCode(200)
  @RequirePermission("liveclass.join")
  async join(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<JoinLiveClassResponse> {
    return this.service.join(user.tenantId, user.id, id);
  }
}
