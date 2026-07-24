// apps/api/src/modules/audit/audit.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/audit-logs (matches @repo/api-client's AuditApi paths exactly).
// Read-only — permission key matched EXACTLY to prisma/seed.ts's catalog key
// "audit_logs.view" (NOT "audit.view" — the OpenAPI registry's documentation-only
// `x-required-permission` string is not authoritative; the seed.ts catalog key is).

import { Controller, Get, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import type { AuditLogEntry } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { AuditService } from "./audit.service";
import { ListAuditLogsQuerySchema, type ListAuditLogsQuery } from "./dto";

@Controller("crm/audit-logs")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission("audit_logs.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListAuditLogsQuerySchema)) query: ListAuditLogsQuery,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    return this.auditService.list(user.tenantId, query);
  }
}
