/**
 * seed-two-factor-reset.ts — registers the `twofa.reset` permission on an EXISTING
 * database (the admin 2FA rescue path: clearing ANOTHER user's second factor).
 *
 * Deliberately separate from `prisma/seed.ts`, for the same reason seed-onboarding.ts is:
 * the full seed is a dev-fixture script that upserts demo students, programs and
 * campaigns, so running it against a live database would inject demo data into a real
 * catalog. This script writes ONLY the one permission and its two role grants.
 *
 * WHY THIS IS NEEDED AT ALL: a permission that is not in the `permissions` table cannot
 * be granted to any role, so nobody can hold it, so POST /crm/admin/users/:id/two-factor/
 * clear is 403 for EVERYONE — including super_admin. Fail-closed, so it is a functional
 * gap rather than a security hole, but the button in Admin ▸ Users will not work until
 * this runs.
 *
 * The SELF-SERVICE recovery flow (POST /auth/2fa/recovery/*) needs none of this — it is
 * unauthenticated and permission-free by design. Only the admin rescue path depends on
 * this script.
 *
 * Idempotent: permission and grants are upserts.
 *
 * Run:  pnpm db:seed:twofa-reset
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

const PERMISSION = { key: "twofa.reset", label: "Clear Another User's Two-Factor Authentication" };

/**
 * super_admin + admin ONLY, matching prisma/seed.ts's grants block.
 *
 * Deliberately NOT support/counsellor even though they work the front line: a
 * social-engineering call ("I'm locked out, clear my 2FA") should have to reach an admin.
 * And deliberately NOT bundled into the own-scope `twofa.manage` that every role already
 * holds — that would let any student strip a colleague's second factor.
 */
const ROLE_KEYS = ["super_admin", "admin"] as const;

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG, deletedAt: null } });
  if (!tenant) throw new Error(`[seed-twofa-reset] tenant "${TENANT_SLUG}" not found`);

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
      console.warn(`[seed-twofa-reset] role "${roleKey}" not found — skipping its grant`);
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
  console.log(`[seed-twofa-reset] permission "${PERMISSION.key}" upserted, ${grantsWritten} role grants written`);
  console.log("[seed-twofa-reset] done — Admin ▸ Users now shows the Clear 2FA action for super_admin/admin");
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
