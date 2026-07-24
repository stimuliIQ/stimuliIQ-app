// apps/api/src/modules/search/search.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/me/search — own-enrolled scope (see search.service.ts).
//
// Permission: search.use (scope: own — granted to `student` role only, prisma/seed.ts).

import { Controller, Get, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import type { GlobalSearchResponse } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { SearchService } from "./search.service";
import { GlobalSearchQuerySchema, type GlobalSearchQuery } from "./dto";

@Controller("me/search")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @RequirePermission("search.use")
  async search(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(GlobalSearchQuerySchema)) query: GlobalSearchQuery,
  ): Promise<GlobalSearchResponse> {
    return this.service.search(user.tenantId, user.id, query);
  }
}
