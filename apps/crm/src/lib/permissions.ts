// RBAC-aware rendering helper — shared by every CRM module (nav, row actions,
// create/edit/delete buttons). This is PRESENTATION ONLY: the NestJS
// `@RequirePermission` guard + `ScopeInterceptor` are the only real
// enforcement point (CLAUDE.md §3 rule 5, docs/04 §3.6). Hiding a control
// here just avoids showing affordances the API would reject with 403 — it
// must never be relied on for security, and every mutating call still goes
// through the server, which still checks + audits.
import type { MeResponse, PermissionGrant } from "@repo/types";

/** True if the current user holds the given `module.action` permission key (any scope). */
export function hasPermission(permissions: PermissionGrant[] | undefined, key: string): boolean {
  return (permissions ?? []).some((grant) => grant.key === key);
}

/**
 * True if the user holds `key` at one of `scopes`.
 *
 * Holding a permission is not the same as being able to USE it. Some modules can only
 * resolve a subset of the data-scopes their permission is granted at, and reject the rest
 * fail-closed. The faculty role holds `courses.view` at scope `assigned`, meaning
 * "programs this faculty authors" — but `programs` has no author column, so
 * courses.service.ts refuses any scope other than `all` (403 `courses.scope_unresolvable`)
 * rather than silently widening it to every program.
 *
 * A plain `hasPermission` check therefore renders a Courses nav item for faculty that can
 * only ever lead to an error screen. Gate on the scope the module can actually serve.
 *
 * Presentation only, like everything else in this file — the server still decides.
 */
export function hasPermissionAtScope(
  permissions: PermissionGrant[] | undefined,
  key: string,
  scopes: readonly PermissionGrant["scope"][],
): boolean {
  return (permissions ?? []).some((grant) => grant.key === key && scopes.includes(grant.scope));
}

/** Convenience bundle of the CRUD checks a module's UI typically branches on. */
export interface ModulePermissions {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function getModulePermissions(me: MeResponse | undefined, module: string): ModulePermissions {
  const permissions = me?.permissions;
  return {
    canView: hasPermission(permissions, `${module}.view`),
    canCreate: hasPermission(permissions, `${module}.create`),
    canEdit: hasPermission(permissions, `${module}.edit`),
    canDelete: hasPermission(permissions, `${module}.delete`),
  };
}
