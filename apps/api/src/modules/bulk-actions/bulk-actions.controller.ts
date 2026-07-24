// apps/api/src/modules/bulk-actions/bulk-actions.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/bulk/* (docs/plans/phase-9-completion.md T30).
//
// Permissions: bulk.leads / bulk.students (seeded + granted, prisma/seed.ts) — the
// GRANTED SCOPE for these permissions is what row-level filtering rides on (see
// bulk-actions.service.ts's file header).
//
// "Bulk export" (task brief's third bulk-action type) reuses the EXISTING exports
// module (`POST /api/v1/crm/exports` with `type: "leads" | "students"`,
// apps/api/src/modules/exports) rather than a new endpoint here — that module already
// runs the exact same scoped `LeadsService.list()`/`StudentsService.list()` methods
// (Rule H-2, exports.service.ts's file header) and enforces the `reports.export` +
// domain-view-permission pairing. No new work needed for that leg of T30.

import { Body, Controller, HttpCode, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { BulkActionsService } from "./bulk-actions.service";
import {
  BulkAssignLeadsRequestSchema,
  type BulkAssignLeadsRequest,
  BulkMoveLeadsStageRequestSchema,
  type BulkMoveLeadsStageRequest,
  BulkUpdateStudentsStatusRequestSchema,
  type BulkUpdateStudentsStatusRequest,
  type BulkActionResponse,
} from "./dto";

@Controller("crm/bulk")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class BulkActionsController {
  constructor(private readonly service: BulkActionsService) {}

  @Post("leads/assign")
  @HttpCode(200)
  @RequirePermission("bulk.leads")
  async bulkAssignLeads(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(BulkAssignLeadsRequestSchema)) body: BulkAssignLeadsRequest,
  ): Promise<BulkActionResponse> {
    return this.service.bulkAssignLeads(user.tenantId, body);
  }

  @Post("leads/stage")
  @HttpCode(200)
  @RequirePermission("bulk.leads")
  async bulkMoveLeadsStage(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(BulkMoveLeadsStageRequestSchema)) body: BulkMoveLeadsStageRequest,
  ): Promise<BulkActionResponse> {
    return this.service.bulkMoveLeadsStage(user.tenantId, body);
  }

  @Post("students/status")
  @HttpCode(200)
  @RequirePermission("bulk.students")
  async bulkUpdateStudentsStatus(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(BulkUpdateStudentsStatusRequestSchema)) body: BulkUpdateStudentsStatusRequest,
  ): Promise<BulkActionResponse> {
    return this.service.bulkUpdateStudentsStatus(user.tenantId, body);
  }
}
