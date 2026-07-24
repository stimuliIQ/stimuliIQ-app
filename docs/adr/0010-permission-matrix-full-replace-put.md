# ADR 0010: Permission-matrix full-replace PUT, privilege-escalation guard, and raw-SQL hard-delete in replaceGrants

## Status
Accepted

## Context
`docs/03-prd-crm.md §9` specifies that an admin should be able to assign permissions
to roles through a matrix editor. The naïve approach (PATCH individual grants) creates
a UX problem: the matrix has ~80 cells (8 modules × 6 actions × up to 4 scopes), and
a PATCH-per-cell API would require dozens of round-trips and complex client-side
conflict resolution.

Two related problems arose during Phase-1 implementation:

1. **Privilege escalation**: an admin editing a role's permission matrix could grant
   that role permissions or scopes that exceed their own grants — for example, granting
   `all` scope on `students.delete` when the editor only has `branch` scope themselves.

2. **Soft-delete vs. hard-delete on `role_permissions`**: the Prisma soft-delete
   extension (ADR-0005) wraps all `delete` calls to set `deleted_at` rather than
   hard-deleting. For `role_permissions` this creates a problem: `@@unique([roleId,
   permissionId])` means a soft-deleted grant for a given (role, permission) pair
   blocks creating a new row for that same pair if the user later re-adds it via
   the matrix editor. The `replaceGrants` operation needs to genuinely remove old
   grants, not just soft-delete them.

## Decision

### Full-replace PUT
`PUT /admin/roles/:id/permissions` accepts the complete desired permission matrix as
its body and performs an **atomic full-replace** in a single transaction:
1. Delete all existing grants for the role.
2. Insert the new set of grants from the request body.

This is a simpler contract for the client (send the whole matrix, get the whole matrix
back) and avoids partial-update edge cases.

### Privilege-escalation guard
Before any grant is inserted, `roles.service.ts` validates that every requested
(permission_key, scope) pair does not exceed the editing user's own grants. The
scope ordering is `own < assigned < branch < all`. A user may only grant a permission
at a scope equal to or lower than their own effective scope for that permission. If
any requested grant exceeds the editor's scope, the entire request is rejected with
403 and no grants are changed (atomic — all or nothing).

The scope rank ordering (`own=0`, `assigned=1`, `branch=2`, `all=3`) is defined as a
constant in the service, not the DB, so it can be revised without a migration.

### Raw-SQL hard-delete in replaceGrants
The delete step in `replaceGrants` uses a parameterized `$executeRaw`:

```sql
DELETE FROM role_permissions
WHERE role_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
```

This **opts out of the Prisma soft-delete extension** (ADR-0005) for this specific
call site. The rationale:
- Soft-deleted `role_permissions` rows with `deleted_at` set still occupy the
  `@@unique([roleId, permissionId])` index slot and would block re-insertion of the
  same grant after a round-trip through the matrix editor.
- `role_permissions` is an association table with no independent lifecycle value once
  removed — unlike a student profile or a batch, a permission grant that has been
  revoked carries no meaningful audit trail beyond the audit log entry for the
  `replaceGrants` operation itself.
- Retention of soft-deleted grant rows would silently make the effective permission
  set unpredictable (which of the `deleted_at = null` and `deleted_at = <timestamp>`
  rows for the same (role, permission) pair applies?).

The `$executeRaw` is parameterized (no string interpolation) and includes `tenant_id`
as a secondary filter to prevent a cross-tenant delete even in the event of a
misconfigured `roleId`.

The `replaceGrants` mutation is itself captured in `audit_logs` (before = old grants
snapshot, after = new grants snapshot) so the effective permission change is traceable
regardless of the hard-delete.

## Consequences
- The matrix editor always works correctly regardless of how many times grants are
  added and removed — no stale soft-deleted rows accumulate.
- The privilege-escalation guard closes the risk that a branch-scoped admin could
  accidentally or deliberately elevate a role above their own capability level.
- The `$executeRaw` site is an intentional, documented exception to the soft-delete
  extension. Future contributors must not generalize this pattern to other tables
  without the same explicit analysis; the raw SQL site is marked with a comment
  explaining the opt-out rationale.
- A separate open follow-up: system roles (is_system = true) currently have no
  additional guard — any `all`-scoped admin can overwrite `super_admin` role grants.
  Recommend a guard that prohibits editing grants on system roles (tracked in
  `docs/phase-1-followups.md`).

## Alternatives considered
- **PATCH individual grants**: finer-grained, lower risk per call — but requires N
  round-trips for a matrix edit and complex client-side tracking of which cells changed.
  Rejected in favor of the full-replace PUT for the matrix use case.
- **Keep soft-delete for role_permissions, use upsert instead of insert**: an upsert
  on the unique key would restore soft-deleted rows. The semantics become confusing
  (is this a restore or a new grant?), and soft-deleted grant rows still accumulate
  over time. Rejected.
- **Separate `role_permission_history` table for the audit trail**: would allow pure
  hard-deletes everywhere while keeping a history of grant changes. Adds a table and
  a join for a concern already covered by `audit_logs`. Rejected as over-engineering
  for P1.
