# ADR 0005: Soft-delete and audit as composed Prisma client extensions with an ALS request-context seam

## Status
Accepted

## Context
`CLAUDE.md §3.4` requires every table to carry `created_at`/`updated_at`/`deleted_at`
and `CLAUDE.md §4` requires a soft-delete + audit-log entry for every mutating action.
`docs/05-database-design.md §5/§6` specifies the soft-delete and audit-trail rules at
the schema level. Phase-0 task #6 (`docs/plans/phase-0.md`) needed an implementation
mechanism that works uniformly across every Prisma model without each service author
remembering to call it manually.

## Decision
Both concerns are implemented as **Prisma Client Extensions**
(`apps/api/src/prisma/soft-delete.extension.ts`, `apps/api/src/prisma/audit.extension.ts`),
composed in a fixed order on the Prisma client (`prisma.service.ts`):

```
client.$extends(auditExtension).$extends(softDeleteExtension)
```

Audit is the **inner** layer, soft-delete the **outer** layer — this matters because
`softDeleteExtension` redirects `delete`/`deleteMany` calls into `update`/`updateMany`
calls that re-enter the client; for the audit layer to still observe those redirected
calls, it must sit underneath soft-delete in the composition.

Actor/tenant/IP context for each request is carried via an `AsyncLocalStorage`-based
seam (`apps/api/src/prisma/audit-context.ts`), populated by middleware wired in after
the auth module resolves the request's user. Without that middleware in scope, audit
rows still get written with `actor_id: null`, never silently skipped.

Audit writes are **post-commit and best-effort**: they happen after the underlying
mutation succeeds, on the same extended client, so an audit insert inside an
interactive `$transaction` rolls back together with the mutation it describes.

A **`SECRET_FIELDS` denylist + per-model allowlist** (added in the Wave 6 security
remediation) redacts sensitive fields — notably `passwordHash` and `refreshHash` —
from the `before`/`after` JSON snapshots stored in `audit_logs`, closing findings
H-1/H-2 from the security review.

`audit_logs` itself is exempt from soft-delete (no `deleted_at` column) — it is an
append-only trail; only a privileged retention/purge job may hard-delete rows.

## Consequences
- Soft-delete and audit logging apply automatically to every model that opts in,
  with no per-service boilerplate — a developer writing a new feature module gets
  both for free as long as they go through the shared Prisma client.
- The ALS context seam decouples the extensions (which only know about Prisma calls)
  from HTTP/request concerns (which only the NestJS middleware layer knows about);
  this keeps the extensions testable in isolation (see
  `soft-delete-audit.integration.spec.ts`, `audit.extension.spec.ts`).
- There's a documented gotcha: Prisma calls are lazy (`PrismaPromise`), so a
  non-async callback passed to `auditContextStorage.run(ctx, fn)` that merely
  `return`s an un-awaited Prisma call loses the ALS context, because `.run()` exits
  the scope before the engine request actually fires. Every call site must `await`
  inside the callback. This is a real footgun for future contributors and is called
  out prominently in `audit.extension.ts`'s header comment — worth a lint rule or
  test helper if it bites someone in practice.
- `Session` create/update churn (one row per login, one update per refresh rotation —
  see ADR-0003) means `audit_logs` will grow quickly relative to other tables. This
  was a deliberate trade — keeping the forensic trail of refresh-token rotation
  intact — accepted as a volume/retention problem to solve later (partitioning or a
  retention policy on `audit_logs`), not a correctness problem now. Tracked in
  `docs/phase-0-followups.md`.

## Alternatives considered
- **Prisma middleware (`$use`)** instead of client extensions: the older Prisma API,
  still supported but deprecated in favor of extensions; extensions also compose more
  predictably (explicit `$extends` chaining vs. middleware registration order).
  Rejected in favor of the currently-recommended Prisma pattern.
- **Manual soft-delete/audit calls in every service method**: simplest to reason
  about line-by-line but guarantees drift — someone will eventually forget to call
  it. Rejected; violates the spirit of `CLAUDE.md §4`'s blanket requirement.
- **Database triggers for audit**: would catch every mutation regardless of ORM
  path, including raw SQL, but can't easily capture the *actor* (which lives in
  application-layer request context, not the DB session) without extra plumbing
  (e.g. `SET LOCAL`). Deferred — may be revisited if raw-SQL mutation paths appear
  outside Prisma.
