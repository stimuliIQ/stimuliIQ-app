// apps/api/src/modules/auth/decorators/require-permission.decorator.ts
//
// `@RequirePermission('module.action')` (docs/04-trd-architecture.md §2.4). Attaches
// metadata read by `PermissionsGuard`. MUST be paired with `JwtAuthGuard` (apply both,
// JwtAuthGuard first) since the permission check needs `req.user.permissions`, which
// only JwtAuthGuard/middleware populates. Never trust the client — this is enforced
// entirely server-side; the client only ever sees the *result* (403) of a denied call.

import { SetMetadata } from "@nestjs/common";

export const PERMISSION_KEY = "stimuliiq:requiredPermission";

export const RequirePermission = (permissionKey: string): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_KEY, permissionKey);
