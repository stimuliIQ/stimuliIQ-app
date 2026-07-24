// apps/api/src/modules/mentors/mentor-dashboard.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/me/mentor/dashboard (LOCK-3: the Mentor role logs into the existing
// `crm` app, not a new app and not the LMS — matches @repo/api-client's
// MentorDashboardApi.get() path and the OpenAPI path registered in
// packages/types/src/openapi/registry.ts exactly).
//
// `ScopeInterceptor` is REQUIRED here even though this controller takes no query/param
// scope input itself — `BatchCompletionService.getSummary()` (reused per-batch inside
// `MentorDashboardService`) calls `requireScopeContext()` internally to resolve the
// "assigned" scope via `batch_mentors`, which only exists on the AsyncLocalStorage once
// `ScopeInterceptor` has run for this request.

import { Controller, Get, UseGuards, UseInterceptors } from "@nestjs/common";
import type { MentorDashboardDto } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { MentorDashboardService } from "./mentor-dashboard.service";

@Controller("me/mentor")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class MentorDashboardController {
  constructor(private readonly mentorDashboardService: MentorDashboardService) {}

  @Get("dashboard")
  @RequirePermission("mentor.dashboard.view")
  async getDashboard(@CurrentUser() user: RequestUser): Promise<MentorDashboardDto> {
    return this.mentorDashboardService.getDashboard(user.tenantId, user.id);
  }
}
