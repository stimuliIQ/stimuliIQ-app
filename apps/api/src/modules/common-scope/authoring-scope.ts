// apps/api/src/modules/common-scope/authoring-scope.ts
//
// Fail-closed narrowing of a resolved `PermissionScope` down to the two scopes the P4
// authoring/grading CRM surfaces (assessments, assignments/submissions, certificates)
// actually implement.
//
// WHY THIS EXISTS
//
// Those three modules used to receive their scope as:
//
//     const ctx = getScopeContext();
//     const scope = (ctx?.scope ?? "all") as "all" | "assigned" | "branch";
//
// Both halves of that line were unsafe, and the cast hid it from the compiler:
//
//   1. `?? "all"` is the exact fallback `scope-context.ts` names as "the bug this
//      hardening exists to prevent" — a missing scope context widened to every row.
//   2. The cast asserted a value the guard can genuinely produce (`"own"`) was
//      impossible. Every service then branched only on `=== "assigned"`, so `"own"`
//      and `"branch"` fell through to the unfiltered all-scope path.
//
// That was reachable, not theoretical. `prisma/seed.ts` grants the STUDENT role
// `assessments.view`, `assignments.view`, `submissions.view` and `certificates.view` at
// scope `own`, and nothing stops an LMS session calling a `/crm/*` route: the app/role
// audience gate runs at LOGIN only, and `PermissionsGuard` matches on the permission KEY
// alone. So an ordinary student holding a valid session could call
// `GET /crm/assessments/:id` and receive the answer key, or `GET /crm/submissions/:id`
// and receive another student's work plus its signed download URLs.
//
// WHY `branch` THROWS RATHER THAN FILTERING
//
// `branch` is seeded for `branch_manager` on these keys but has never been implemented
// in any of the three modules, and for assessments it is not even well defined — an
// assessment hangs off a module → program, and a program belongs to no branch. Silently
// treating it as "all" is what this file exists to stop. Refusing it follows the
// convention the rest of the codebase already uses for a scope a module cannot resolve
// (see `BatchesService.resolveListRestriction`, which throws
// `batches.scope_unresolvable` for exactly this case). If branch managers are meant to
// have these screens, implement a real branch filter and add the case here — do not
// widen the default.

import { ForbiddenException } from "@nestjs/common";
import type { PermissionScope } from "@repo/types";

/** The scopes the P4 authoring/grading services genuinely implement. */
export type AuthoringScope = "all" | "assigned";

/**
 * Narrows a resolved permission scope to `all | assigned`, throwing 403 for anything
 * else. Call this at the top of every CRM authoring/grading service method, before any
 * repository read — an unsupported scope must never reach a query.
 *
 * @param module Permission-key prefix used in the error code (e.g. "assessments").
 * @param scope  The scope resolved by `PermissionsGuard`, straight from
 *               `requireScopeContext().scope`. `null`/`undefined` is treated as
 *               unresolved and refused, never as "all".
 */
export function assertAuthoringScope(
  module: string,
  scope: PermissionScope | null | undefined,
): AuthoringScope {
  if (scope === "all" || scope === "assigned") {
    return scope;
  }

  throw new ForbiddenException({
    code: `${module}.scope_unresolvable`,
    title: "Permission denied",
    detail:
      scope === "own"
        ? `The "own" data-scope has no meaning on a ${module} CRM route — use the student-facing /me endpoints instead.`
        : `The "${scope ?? "unresolved"}" data-scope is not implemented for the ${module} CRM routes.`,
  });
}
