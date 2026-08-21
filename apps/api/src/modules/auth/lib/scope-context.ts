// apps/api/src/modules/auth/lib/scope-context.ts
//
// Data-scope context (docs/04-trd-architecture.md §2.4: all|branch|assigned|own).
// `PermissionsGuard` resolves which scope the current user's matched permission grants
// and attaches it to `req.scope`; `ScopeInterceptor` (interceptors/scope.interceptor.ts)
// then publishes it on an AsyncLocalStorage so REPOSITORIES — which have no access to
// the HTTP request object, by design (CLAUDE.md §3.3 layering) — can read it via
// `getScopeContext()` and translate it into a Prisma `where` filter.
//
// HOW REPOSITORIES CONSUME THIS (documented contract for future modules):
//   const scope = requireScopeContext(); // throws if missing — see FAIL-CLOSED below
//   const where = applyScopeFilter(scope, {
//     all: {},
//     branch: { branchId: someBranchIdFromReqUser },
//     assigned: { assignedToUserId: actorId },
//     own: { ownerUserId: actorId },
//   });
// i.e. each repository defines its OWN mapping from the four scope values to a
// model-specific Prisma where-clause fragment (since "own"/"assigned"/"branch" mean
// different columns on different models) and merges it into its query. This module only
// carries the *resolved scope value* + the acting user's identity — it intentionally
// does not hardcode any model-specific filter, keeping repositories the only place that
// knows their own schema (no business logic leaking into guards/interceptors).
//
// FAIL-CLOSED CONTRACT (Wave 6 security audit ALS caveat — must read before writing any
// CRM repository against this module): `getScopeContext()` returns `undefined` outside
// any `.run()` scope (e.g. a repository method called from a background job, a buggy
// interceptor ordering, or before `ScopeInterceptor` has run at all). An `undefined`
// scope context MUST NEVER be treated as "no filter"/"all" — that would silently grant
// unscoped access to every row in a multi-tenant table. There are two safe ways to
// consume this module:
//   1. `requireScopeContext()` (below) — throws `ScopeContextMissingError` if the ALS
//      store is empty. Use this in any repository method that is reachable from an
//      authenticated, permission-guarded HTTP route — i.e. anywhere `ScopeInterceptor`
//      is expected to have already run. This is the DEFAULT choice.
//   2. `getScopeContext()` (raw, may return `undefined`) — only for call sites that
//      legitimately run outside any scoped request (system/seed scripts) AND that
//      build their own explicit, hardcoded filter rather than ever calling
//      `applyScopeFilter` with a possibly-undefined context. If you find yourself
//      writing `getScopeContext() ?? { scope: "all", ... }` or any other fallback that
//      widens access on a missing context, that is the bug this hardening exists to
//      prevent — use `requireScopeContext()` instead.
// `applyScopeFilter` itself (when a future module adds one) must accept a *required*
// `ScopeContext`, not an optional one, so this fail-closed behavior is enforced at the
// type level, not just by convention.

import { AsyncLocalStorage } from "node:async_hooks";
import type { PermissionScope } from "@repo/types";

export interface ScopeContext {
  permissionKey: string;
  scope: PermissionScope;
  actorId: string;
  tenantId: string;
}

export const scopeContextStorage = new AsyncLocalStorage<ScopeContext>();

/** Raw accessor — may legitimately return `undefined`. See FAIL-CLOSED CONTRACT above before using this directly; most repositories should call `requireScopeContext()` instead. */
export function getScopeContext(): ScopeContext | undefined {
  return scopeContextStorage.getStore();
}

/** Thrown by `requireScopeContext()` when no scope context is present on the ALS store. */
export class ScopeContextMissingError extends Error {
  constructor() {
    super(
      "Scope context is missing. A scoped repository call was made outside of " +
        "ScopeInterceptor's AsyncLocalStorage run() scope. Refusing to fall open to an " +
        "unscoped ('all') query. If this call site is intentionally outside an HTTP " +
        "request (system/seed script), use getScopeContext() and build an explicit " +
        "filter instead of requireScopeContext().",
    );
  }
}

/**
 * FAIL-CLOSED accessor for repositories (Wave 6 security audit). Returns the current
 * `ScopeContext` or throws `ScopeContextMissingError` — it never substitutes a default
 * "all"/unscoped context. Repositories MUST use this (not `getScopeContext()`) for any
 * query reachable from an authenticated, permission-guarded route, so a missing/bugged
 * scope-resolution step fails the request loudly instead of silently widening access.
 */
export function requireScopeContext(): ScopeContext {
  const ctx = scopeContextStorage.getStore();
  if (!ctx) {
    throw new ScopeContextMissingError();
  }
  return ctx;
}
