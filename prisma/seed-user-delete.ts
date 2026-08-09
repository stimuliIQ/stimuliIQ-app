/**
 * seed-user-delete.ts — registers the `users.remove` permission on an EXISTING database.
 *
 * `users.remove` gates DELETE /crm/admin/users/:id/permanent, which takes a staff account
 * out of the CRM entirely (soft-delete + session revocation). That is a different act from
 * `users.delete`, which despite its name only DEACTIVATES the login and is already held by
 * admin as well as super_admin.
 *
 * Deliberately separate from `prisma/seed.ts`, for the same reason seed-onboarding.ts and
 * seed-two-factor-reset.ts are: the full seed is a dev-fixture script that upserts demo
 * students, programs and campaigns, so running it against a live database would inject demo
 * data into a real catalog. This script writes ONLY the one permission and its one grant.
 *
 * WHY THIS IS NEEDED AT ALL: a permission absent from the `permissions` table cannot be
 * granted to any role, so nobody holds it, so the route 403s for EVERYONE — including
 * super_admin. Fail-closed, so it is a functional gap rather than a security hole, but the
 * Delete action in Admin ▸ Users will not appear until this runs.
 *
 * Idempotent: the permission and its grant are upserts.
 *
 * Run:  pnpm db:seed:user-delete
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

const PERMISSION = { key: "users.remove", label: "Delete Staff Users" };

/**
 * super_admin ONLY — the point of the separate key.
 *
 * `admin` holds users.view/create/edit/delete and can therefore stop anyone signing in.
 * Removing an account from the product is a step beyond that: it hides the person from
 * every staff picker and owner list, and it is the one user-management action nobody but
 * the account owner's own organisation head should be taking. Adding `admin` here would
 * quietly collapse the distinction the permission exists to draw.
 */
const ROLE_KEYS = ["super_admin"] as const;

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG, deletedAt: null } });
  if (!tenant) throw new Error(`[seed-user-delete] tenant "${TENANT_SLUG}" not found`);

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
      console.warn(`[seed-user-delete] role "${roleKey}" not found — skipping its grant`);
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
  console.log(`[seed-user-delete] permission "${PERMISSION.key}" upserted, ${grantsWritten} role grant written`);
  console.log("[seed-user-delete] done — Admin ▸ Users now shows the Delete action for super_admin only");
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
