// apps/api/src/modules/auth/guards/jwt-auth.guard.ts
//
// Enforces a valid `access_token` cookie for protected routes (docs/04-trd-architecture.md
// §2.3). Uses the same `resolveRequestUser` helper as the audit-context middleware, so
// by the time this guard runs `req.user` is USUALLY already populated (middleware ran
// first) — but the guard re-resolves defensively (cheap: in-memory JWT verify + a
// cached-by-request-lifecycle Prisma read) rather than trusting middleware state blindly,
// so this guard is correct even if applied to an app that, in a future refactor, omits
// the middleware. Throws 401 (mapped to RFC-7807 by the global exception filter) when no
// valid session exists.

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthRepository } from "../auth.repository";
import { TokenService } from "../lib/token.service";
import { resolveRequestUser } from "../lib/resolve-request-user";
import { readAudienceHeader } from "../lib/cookies";
import { AccessTokenRevocationStore } from "../lib/access-token-revocation";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly authRepository: AuthRepository,
    private readonly accessTokenRevocation: AccessTokenRevocationStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const user =
      req.user ??
      (await resolveRequestUser(
        req.cookies,
        this.tokenService,
        this.authRepository,
        this.accessTokenRevocation,
        readAudienceHeader(req),
      ));
    if (!user) {
      throw new UnauthorizedException({
        code: "auth.unauthenticated",
        title: "Authentication required",
        detail: "A valid access_token cookie is required for this route.",
      });
    }

    req.user = user;
    return true;
  }
}
