// apps/api/src/prisma/purge-audit-logs.ts
//
// `audit_logs` is append-only at the Postgres level (migration audit_logs_immutability):
// a `audit_logs_guard` trigger rejects every DELETE unless the session has
// `SET LOCAL app.allow_audit_purge = 'on'` in the SAME transaction as the delete. This is
// the ONLY sanctioned way to hard-delete audit rows, and it exists solely for disposable
// local integration-test teardown (`local-db-guard.ts` gates the specs that call this to
// a loopback, `_test`-suffixed database — see its header for why).
//
// Do NOT reach for `prisma.auditLog.deleteMany(...)` directly in a new test: the trigger
// will reject it (correctly), and the extended Prisma client's audit extension
// (`audit.extension.ts` `guardAuditLogMutation`) also throws on it independently. Use this
// helper, which wraps the delete in an interactive `$transaction` so the `SET LOCAL` and
// the `deleteMany` are guaranteed to run on the same connection (a plain `SET` — without
// LOCAL, or outside a transaction — would not reliably apply, since Prisma's pool can hand
// out a different pooled connection per query).
//
// `client` must be a BASE (non-audit-extended) `PrismaClient` — every existing call site
// already is (`base`, `raw`, or the plain `PrismaClient` fixture files receive).

import type { Prisma, PrismaClient } from "@prisma/client";

export async function purgeAuditLogs(
  client: PrismaClient,
  where: Prisma.AuditLogWhereInput,
): Promise<void> {
  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL app.allow_audit_purge = 'on'");
    await tx.auditLog.deleteMany({ where });
  });
}
