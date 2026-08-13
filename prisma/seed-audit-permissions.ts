/**
 * seed-audit-permissions.ts — narrows the audit-log permission surface to VIEW ONLY on an
 * EXISTING database.
 *
 * Deliberately separate from `prisma/seed.ts`, for the same reason seed-onboarding.ts and
 * seed-two-factor-reset.ts are: the full seed is a dev-fixture script that upserts demo
 * students, programs and campaigns, so running it against a live database would inject
 * demo data into a real catalog. This script touches ONLY the `audit_logs.*` permission
 * rows and the role grants that point at them.
 *
 * WHY THIS IS NEEDED: the permission catalog was generated as a cross-product of P1 modules
 * × the standard action set, which minted `audit_logs.create/edit/delete/export/approve`
 * alongside `audit_logs.view`, and the super_admin/admin grant loop then handed over the
 * whole catalog at scope=all. The RBAC matrix therefore showed Super Admin holding edit and
 * delete rights over the audit trail.
 *
 * Those keys were always inert — `audit_logs.view` is the only one any code reads, and the
 * audit controller exposes no write verb — but a permission the UI displays and nothing
 * enforces is indistinguishable, to whoever is reading the matrix, from one that works.
 * An audit trail nobody can edit is the whole point of keeping one, so the write keys
 * should not exist to be granted in the first place.
 *
 * Actual immutability enforcement is elsewhere and unaffected by this script: the Postgres
 * trigger and the Prisma extension guard added in migration `audit_logs_immutability`.
 * This only removes the misleading grant surface sitting on top of them.
 *
 * Idempotent: the view permission and its grants are upserts; the stale keys are deleted
 * only if present, so re-running is a no-op.
 *
 * Run:  pnpm db:seed:audit-permissions
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const VIEW_PERMISSION = { key: "audit_logs.view", label: "View Audit Logs" };

/** Matches prisma/seed.ts — reading the audit trail is a super_admin/admin capability. */
const ROLE_KEYS = ["super_admin", "admin"] as const;

/**
 * Hard-deleted rather than soft-deleted: `Permission`/`RolePermission` are catalog rows,
 * not business records, and a soft-deleted permission that RBAC still resolves would
 * defeat the point of removing it.
 */
const STALE_KEYS = [
  "audit_logs.create",
  "audit_logs.edit",
  "audit_logs.delete",
  "audit_logs.approve",
  "audit_logs.export",
];

async function main(): Promise<void> {
  const viewPermission = await prisma.permission.upsert({
    where: { key: VIEW_PERMISSION.key },
    update: { label: VIEW_PERMISSION.label },
    create: VIEW_PERMISSION,
  });

  let grantsWritten = 0;
  for (const roleKey of ROLE_KEYS) {
    const role = await prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) continue;
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: viewPermission.id } },
      update: { scope: RolePermissionScope.all },
      create: { roleId: role.id, permissionId: viewPermission.id, scope: RolePermissionScope.all },
    });
    grantsWritten += 1;
  }

  const stale = await prisma.permission.findMany({
    where: { key: { in: STALE_KEYS } },
    select: { id: true, key: true },
  });

  let grantsRemoved = 0;
  if (stale.length > 0) {
    const staleIds = stale.map((row) => row.id);
    const removed = await prisma.rolePermission.deleteMany({
      where: { permissionId: { in: staleIds } },
    });
    grantsRemoved = removed.count;
    await prisma.permission.deleteMany({ where: { id: { in: staleIds } } });
  }

  /* eslint-disable no-console */
  console.log(`[seed-audit-permissions] "${VIEW_PERMISSION.key}" upserted, ${grantsWritten} role grants written`);
  console.log(
    `[seed-audit-permissions] removed ${stale.length} stale write permission(s) ` +
      `(${stale.map((row) => row.key).join(", ") || "none"}) and ${grantsRemoved} grant(s)`,
  );
  console.log("[seed-audit-permissions] done — audit logs are view-only for every role, super_admin included");
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
