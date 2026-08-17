/**
 * seed-user-reset-password.ts — registers the `users.reset_password` permission on an
 * EXISTING database.
 *
 * `users.reset_password` gates POST /crm/admin/users/:id/reset-password, which rotates a
 * staff member's CRM password and emails them a one-time replacement. That is a different
 * act from `users.edit`, which changes a profile and is already held by admin as well as
 * super_admin.
 *
 * Deliberately separate from `prisma/seed.ts`, for the same reason seed-user-delete.ts and
 * seed-onboarding.ts are: the full seed is a dev-fixture script that upserts demo students,
 * programs and campaigns, so running it against a live database would inject demo data into
 * a real catalog. This script writes ONLY the one permission and its one grant.
 *
 * WHY THIS IS NEEDED AT ALL: a permission absent from the `permissions` table cannot be
 * granted to any role, so nobody holds it, so the route 403s for EVERYONE — including
 * super_admin. Fail-closed, so it is a functional gap rather than a security hole, but the
 * "Reset password" action in Admin ▸ Users will not appear until this runs.
 *
 * Idempotent: the permission and its grant are upserts.
 *
 * Run:  pnpm db:seed:user-reset-password
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

const PERMISSION = { key: "users.reset_password", label: "Reset Staff Passwords" };

/**
 * super_admin ONLY — the point of the separate key.
 *
 * `admin` holds users.view/create/edit/delete. Reissuing someone's credentials is a step
 * beyond editing them: the temporary password lands in the target's inbox, so an admin who
 * can reset a SUPER admin's password can take over the stronger account via that mailbox
 * (or simply be the recipient, where a shared support address is involved). Adding `admin`
 * here would quietly create the privilege-escalation path the separate key exists to close.
 */
const ROLE_KEYS = ["super_admin"] as const;

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG, deletedAt: null } });
  if (!tenant) throw new Error(`[seed-user-reset-password] tenant "${TENANT_SLUG}" not found`);

  const permission = await prisma.permission.upsert({
    where: { key: PERMISSION.key },
    update: { label: PERMISSION.label },
    create: { key: PERMISSION.key, label: PERMISSION.label },
  });

  let grantsWritten = 0;
  for (const roleKey of ROLE_KEYS) {
    const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: roleKey } });
    if (!role) {
      // eslint-disable-next-line no-console
      console.warn(`[seed-user-reset-password] role "${roleKey}" not found — skipping its grant`);
      continue;
    }
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: { scope: RolePermissionScope.all },
      create: { roleId: role.id, permissionId: permission.id, scope: RolePermissionScope.all },
    });
    grantsWritten += 1;
  }

  /* eslint-disable no-console */
  console.log(`[seed-user-reset-password] permission "${PERMISSION.key}" upserted, ${grantsWritten} role grant written`);
  console.log(
    "[seed-user-reset-password] done — Admin ▸ Users now shows the Reset password action for super_admin only",
  );
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
