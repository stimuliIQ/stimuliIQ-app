// apps/api/src/common/middleware/audit-context.middleware.ts
//
// Wires the AsyncLocalStorage seam documented in apps/api/src/prisma/audit-context.ts.
// Runs early in the Express middleware chain (registered in app.module.ts via
// `MiddlewareConsumer.apply(...).forRoutes("*")`), BEFORE Nest guards/interceptors —
// but it resolves `req.user` itself (via the shared `resolveRequestUser` helper, the
// same one `JwtAuthGuard` uses) precisely so the audit context already has actorId by
// the time any guard or controller code runs and triggers a Prisma write. This satisfies
// the seam's requirement to run "after auth has resolved req.user": auth resolution
// happens HERE, inside the ALS `.run()` callback, not in a separate later layer.
//
// For unauthenticated routes (login, otp/request, otp/verify) `resolveRequestUser`
// resolves to `undefined` and `actorId` stays undefined — the audit extension writes
// `actor_id: null` in that case, which is allowed (audit.extension.ts).

import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { auditContextStorage } from "../../prisma/audit-context";
import { AuthRepository } from "../../modules/auth/auth.repository";
import { TokenService } from "../../modules/auth/lib/token.service";
import { resolveRequestUser } from "../../modules/auth/lib/resolve-request-user";
import { readAudienceHeader } from "../../modules/auth/lib/cookies";

@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  constructor(
    private readonly tokenService: TokenService,
    private readonly authRepository: AuthRepository,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    auditContextStorage.run({}, () => {
      void this.resolveAndContinue(req, res, next);
    });
  }

  private async resolveAndContinue(req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = await resolveRequestUser(
      req.cookies,
      this.tokenService,
      this.authRepository,
      readAudienceHeader(req),
    );
    if (user) {
      req.user = user;
    }

    // Re-run inside a freshly-scoped ALS context now that we know actorId/tenantId —
    // `.run()` must wrap the rest of the pipeline (guards/controller/services), and per
    // the ALS-laziness gotcha (audit.extension.ts), any Prisma call downstream must be
    // awaited *inside* this scope, which holds because Express's `next()` synchronously
    // dispatches into the rest of the (still-async) request pipeline before this
    // function's promise resolves.
    auditContextStorage.run(
      {
        tenantId: user?.tenantId,
        actorId: user?.id,
        ip: req.ip,
      },
      () => next(),
    );
  }
}
