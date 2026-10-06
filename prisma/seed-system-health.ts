/**
 * Seeds the one permission behind CRM ▸ Admin ▸ System Health and grants it to super_admin.
 *
 * WHY A SEPARATE SCRIPT: on a database that is already live, `pnpm db:seed` upserts demo
 * students, programs and campaigns, so it must not be run there. This writes the permission and
 * one grant, nothing else, and is safe to re-run.
 *
 *   system.health.view  -> super_admin ONLY (scope=all)
 *
 * `admin` is deliberately NOT granted it. The screen shows infrastructure topology, versions,
 * which integrations are switched off and student headcounts, which is the owner's view.
 * `prisma/seed.ts` upserts the same permission OUTSIDE its catalog for the same reason, so the
 * admin catch-all loop cannot hand it out.
 *
 * Run:  pnpm db:seed:system-health      (no migration needed — no schema change)
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";
const KEY = "system.health.view";
const LABEL = "View System Health & Platform Status";

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(`[seed-system-health] tenant "${TENANT_SLUG}" not found — run the base seed first.`);
  }

  const permission = await prisma.permission.upsert({
    where: { key: KEY },
    update: { label: LABEL },
    create: { key: KEY, label: LABEL },
  });

  const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: "super_admin" } });
  if (!role) throw new Error('[seed-system-health] role "super_admin" not found — run the base seed first.');

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    update: { scope: RolePermissionScope.all },
    create: { roleId: role.id, permissionId: permission.id, scope: RolePermissionScope.all },
  });

  console.log(`[seed-system-health] ${KEY} granted to super_admin (scope=all). Nobody else holds it.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
