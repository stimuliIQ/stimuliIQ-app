// apps/api/src/modules/auth/guards/permissions.guard.ts
//
// Server-side RBAC enforcement (CLAUDE.md §3.5: "RBAC is enforced server-side, never
// trusted from the client"). Reads the `@RequirePermission('module.action')` metadata
// set on the route handler (or controller class) and checks it against
// `req.user.permissions` (the flattened, resolved grant list populated by
// `JwtAuthGuard`/the audit-context middleware — see auth.repository.ts#getRbacProfile).
// Routes with no `@RequirePermission` metadata are allowed through (authentication-only
// routes like `/me` rely on `JwtAuthGuard` alone, per docs/plans/phase-0.md task #8: "no
// specific module.action permission beyond being authenticated").
//
// On a match, this guard ALSO sets `req.scope` to the matched permission's resolved
// scope (`all|branch|assigned|own`) so the downstream `ScopeInterceptor` (and ultimately
// repositories) can narrow queries accordingly — see scope-interceptor.ts for how that
// filter is consumed.

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PERMISSION_KEY } from "../decorators/require-permission.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermission) {
      return true; // no permission required beyond authentication (e.g. /me).
    }

    const req = context.switchToHttp().getRequest<Request>();
    const grant = req.user?.permissions.find((p) => p.key === requiredPermission);

    if (!grant) {
      throw new ForbiddenException({
        code: "auth.forbidden",
        title: "Permission denied",
        detail: `Missing required permission "${requiredPermission}".`,
      });
    }

    req.scope = { permissionKey: grant.key, scope: grant.scope };
    return true;
  }
}
