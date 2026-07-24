// apps/api/src/modules/auth/me.controller.ts
//
// GET /api/v1/me — the protected route the RBAC guard + ScopeInterceptor are proven on
// end-to-end (docs/plans/phase-0.md task #8). `JwtAuthGuard` alone is sufficient here
// (no `@RequirePermission`): any authenticated user may read their own profile — this is
// intentionally the "authentication only" example, contrasted with `me/audit-sample`
// below, which IS permission + scope gated, so qa-engineer has both an allow/deny case
// (missing permission -> 403) and a scope-narrowing case to test in one module.

import { Controller, Get, UseGuards, UseInterceptors } from "@nestjs/common";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { ScopeInterceptor } from "./interceptors/scope.interceptor";
import { RequirePermission } from "./decorators/require-permission.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import type { RequestUser } from "./lib/request-user";
import { AuthService } from "./auth.service";
import type { MeResponse } from "@repo/types";
import { getScopeContext } from "./lib/scope-context";
import { SkipPasswordGate } from "./decorators/skip-password-gate.decorator";

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class MeController {
  constructor(private readonly authService: AuthService) {}

  /**
   * GET /api/v1/me — authentication-only; no specific module.action permission required
   * beyond holding a valid access_token cookie (docs/04 §2.4).
   */
  @Get("me")
  // Never gate this route: it's how the LMS `FirstLoginGate` (and any client) discovers
  // `mustChangePassword` in the first place — gating it would deadlock a redirect loop
  // for a `mustChangePassword: true` session (gap-closing pass).
  @SkipPasswordGate()
  async getMe(@CurrentUser() user: RequestUser): Promise<MeResponse> {
    return this.authService.getMe(user.id, user.tenantId);
  }

  /**
   * GET /api/v1/me/audit-sample — the MINIMAL real example of a permission + scope
   * gated route (docs/plans/phase-0.md task #8: "add ONE example permission-gated +
   * scoped route ... demonstrates a 403 when the permission is missing and demonstrates
   * scope narrowing"). Requires `audit_log.list`, seeded (prisma/seed.ts) at scope=all
   * for super_admin/admin and NOT granted to faculty/student — so:
   *   - super_admin/admin -> 200, scope "all" (no narrowing; can see every tenant's logs
   *     conceptually, though Phase 0 has only one tenant).
   *   - faculty/student -> 403 (no audit_log.list grant at all) — proves deny-by-default.
   * This endpoint does not yet query a real repository (audit_logs reads land with a
   * future CRM/admin module); it returns the resolved scope context itself so
   * qa-engineer/integration tests can assert exactly what a repository WOULD receive via
   * `getScopeContext()` — see lib/scope-context.ts for the consumption contract.
   */
  @Get("me/audit-sample")
  @RequirePermission("audit_log.list")
  getAuditSample(): { resolvedScope: ReturnType<typeof getScopeContext> } {
    return { resolvedScope: getScopeContext() };
  }
}
