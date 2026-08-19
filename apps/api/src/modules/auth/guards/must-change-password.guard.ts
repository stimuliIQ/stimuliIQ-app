// apps/api/src/modules/auth/guards/must-change-password.guard.ts
//
// Server-side enforcement of the first-login "must change password" gate
// (lifecycle-redesign P3). Registered as a GLOBAL guard (`APP_GUARD` in app.module.ts) —
// unlike `JwtAuthGuard`/`PermissionsGuard` (applied per-controller via `@UseGuards`), this
// guard runs on EVERY route without touching the ~66 existing per-controller guard lists,
// because it only ever reads `req.user` (already populated by `AuditContextMiddleware`,
// which runs on `*` routes before any guard — see audit-context.middleware.ts) and never
// resolves anything itself.
//
// Previously the "must change password before using the app" rule was enforced ONLY
// client-side (apps/lms `FirstLoginGate`, which its own comment calls "a UX gate on top of
// the real control, not the control itself") — a valid session token for a
// `mustChangePassword: true` account could call ANY other authenticated API route. This
// guard is the real, server-side control that comment referred to.
//
// Routes are exempted via `@SkipPasswordGate()` (skip-password-gate.decorator.ts), in two
// groups:
//
//   1. Routes a gated session must reach to CLEAR the gate or inspect it — POST
//      /auth/change-password, POST /auth/logout, POST /auth/refresh, GET /me.
//
//   2. PRE-SESSION routes, which authenticate from the request BODY (credentials, an
//      emailed reset token) and never from `req.user` — POST /auth/login, the whole of
//      /auth/password-reset, /auth/2fa/login-verify and /auth/2fa/recovery. Here
//      `req.user` is only ever a leftover cookie from an earlier sign-in in the same
//      browser; it is not the caller's authorization, so gating on it is meaningless.
//      Leaving them gated locked freshly-provisioned students (who are ALL
//      `mustChangePassword: true`) out of sign-in AND out of password reset — the gate
//      blocking the only two doors out of itself.
//
// Every other route stays gated.

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { SKIP_PASSWORD_GATE_KEY } from "../decorators/skip-password-gate.decorator";

@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // `context.getHandler()`/`getClass()` are only meaningful for HTTP routes bound to a
    // controller method — this guard is HTTP-only (registered globally in app.module.ts,
    // which only serves the REST API), so `switchToHttp()` is always safe here.
    const req = context.switchToHttp().getRequest<Request>();

    // No `req.user` -> either an unauthenticated route (no session cookie resolved by
    // AuditContextMiddleware) or a route whose own guard chain hasn't run yet for some
    // other reason. Not this guard's problem either way — let the route's own
    // authentication guard (JwtAuthGuard, if any) decide whether to admit the request.
    if (!req.user) {
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_PASSWORD_GATE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    if (req.user.mustChangePassword) {
      throw new ForbiddenException({
        code: "auth.password_change_required",
        title: "Password change required",
        detail: "You must set a new password before continuing.",
      });
    }

    return true;
  }
}
