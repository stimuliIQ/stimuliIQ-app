// apps/api/src/modules/auth/lib/request-user.ts
//
// Shape of `req.user` once the access-token cookie has been verified + the user's RBAC
// profile resolved. Populated by `resolveRequestUser()` (used by both the audit-context
// middleware and `JwtAuthGuard`) so every consumer (guards, ScopeInterceptor, pino
// customProps, audit-context) reads the same shape.

import type { PermissionScope } from "@repo/types";
import type { FlattenedPermission } from "../auth.repository";

export interface RequestUser {
  id: string;
  tenantId: string;
  roles: string[];
  permissions: FlattenedPermission[];
  /**
   * Mirrors `user.mustChangePassword` (set by `LmsAccountProvisioningService` on first
   * LMS credential provisioning / reissue). Consumed by `MustChangePasswordGuard`
   * (server-side enforcement — see that guard's header) so a student cannot use a
   * temporary/reissued password to call any route beyond the minimal
   * `@SkipPasswordGate()` allow-list until they actually change their password.
   */
  mustChangePassword: boolean;
}

/** Set by `PermissionsGuard` once it resolves which permission/scope matched the route. */
export interface RequestScope {
  permissionKey: string;
  scope: PermissionScope;
}

// Augment Express's `Request` via the `Express` namespace (NOT
// `declare module "express-serve-static-core"`) — the namespace form resolves
// regardless of how strictly the consuming file's own moduleResolution setting
// can see `@types/express`'s transitive `express-serve-static-core` dependency,
// which is the standard, resolution-independent pattern `@types/express` itself
// documents for consumer augmentation.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- canonical @types/express augmentation idiom.
  namespace Express {
    interface Request {
      user?: RequestUser;
      scope?: RequestScope;
    }
  }
}
