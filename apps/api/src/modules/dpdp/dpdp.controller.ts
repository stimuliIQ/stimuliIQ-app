// apps/api/src/modules/dpdp/dpdp.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3, docs/04-trd-architecture.md §2.1). No business
// logic, no Prisma. Mounted at /api/v1/dpdp.
//
// Permission: `dpdp.erasure.execute` — scope=all, granted ONLY to super_admin/admin
// (prisma/seed.ts P7_PERMISSIONS, docs/specs/phase-7-analytics-hardening.md Part 8). No
// other role holds this permission, so AC-65 ("a non-privileged caller cannot trigger
// erasure for another user") is enforced by PermissionsGuard alone — there is no
// additional own-vs-other check needed here because the permission itself is admin-only.

import { Body, Controller, HttpCode, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Request } from "express";
import type { DpdpErasureRequest, DpdpErasureResponse } from "@repo/types";
import { DpdpErasureRequestSchema } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { DpdpService } from "./dpdp.service";

@Controller("dpdp")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class DpdpController {
  constructor(private readonly service: DpdpService) {}

  /**
   * POST /api/v1/dpdp/erasure
   * Redacts the subject's PII inside existing audit_logs snapshots (AC-64). Does NOT
   * delete the subject's live business rows or the audit_logs rows themselves.
   */
  @Post("erasure")
  @HttpCode(200)
  @RequirePermission("dpdp.erasure.execute")
  async erase(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(DpdpErasureRequestSchema)) body: DpdpErasureRequest,
    @Req() req: Request,
  ): Promise<DpdpErasureResponse> {
    return this.service.eraseSubjectPii(user.tenantId, user.id, body.subjectUserId, req.ip);
  }
}
