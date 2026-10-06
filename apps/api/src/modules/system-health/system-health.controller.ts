// apps/api/src/modules/system-health/system-health.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). `GET /api/v1/crm/system-health`.
//
// Gated on `system.health.view`, which is seeded OUTSIDE the permission catalog in
// prisma/seed.ts so the admin + super_admin catch-all cannot grant it: this screen shows
// infrastructure topology, versions, headcounts and which integrations are unconfigured, and
// that is the owner's view, not an admin's. This is the same device as `leave.approve` and
// `org.teams.manage`. The CRM hides the nav entry for anyone without the key, but this guard
// is the control (CLAUDE.md §3.5).
//
// This is NOT the public `/health` and `/health/ready` (HealthController): those are
// unauthenticated load-balancer probes that must reveal nothing but ok/down.

import { Controller, Get, UseGuards } from "@nestjs/common";
import type { SystemHealthReport } from "@repo/types";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";

import { SystemHealthService } from "./system-health.service";

@Controller("crm/system-health")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SystemHealthController {
  constructor(private readonly service: SystemHealthService) {}

  @Get()
  @RequirePermission("system.health.view")
  async get(@CurrentUser() user: RequestUser): Promise<SystemHealthReport> {
    return this.service.getReport(user.tenantId);
  }
}
