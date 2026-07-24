// apps/api/src/modules/auth/decorators/current-user.decorator.ts
//
// Convenience param decorator for controllers guarded by `JwtAuthGuard` — reads the
// `RequestUser` that guard/middleware already populated onto `req.user`. Never resolves
// the user itself (no business logic, no Prisma) — purely a typed accessor.

import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { RequestUser } from "../lib/request-user";

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.user) {
    // JwtAuthGuard guarantees req.user is set before the handler runs; this branch is
    // unreachable in practice but keeps the decorator's return type non-optional.
    throw new Error("CurrentUser decorator used without JwtAuthGuard");
  }
  return req.user;
});
