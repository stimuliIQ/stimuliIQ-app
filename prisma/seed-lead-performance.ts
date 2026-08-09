/**
 * seed-lead-performance.ts — registers the `reports.lead_performance.view` permission on
 * an EXISTING database (the per-rep lead scoreboard at CRM ▸ Analytics ▸ Team Performance).
 *
 * Deliberately separate from `prisma/seed.ts`, for the same reason seed-onboarding.ts and
 * seed-two-factor-reset.ts are: the full seed is a dev-fixture script that upserts demo
 * students, programs and campaigns, so running it against a live database would inject
 * demo data into a real catalog. This script writes ONLY the one permission and its role
 * grants — it touches no lead, no user, and no existing grant.
 *
 * WHY THIS IS NEEDED AT ALL: a permission that is not in the `permissions` table cannot be
 * granted to any role, so nobody can hold it, so GET /crm/reports/lead-performance is 403
 * for EVERYONE — including super_admin, whose access comes from a catch-all over the
 * catalog rather than from a wildcard. Fail-closed, so it is a functional gap rather than
 * a security hole, but the Team Performance page will render its "no access" state until
 * this runs.
 *
 * NOTE: super_admin and admin are granted here EXPLICITLY. In prisma/seed.ts they receive
 * every catalog permission through a loop over the catalog; that loop only runs during a
 * full seed, so on a live database they would otherwise be left without this new key.
 *
 * Nothing else in the lead-ownership pass needs a seed step — the accountability columns
 * and the `lead_assigned` notification type come from the migration
 * (20260808100000_lead_ownership_accountability), and `notifications.view` is already
 * seeded at scope=own for every role, which is what makes the CRM bell work.
 *
 * Idempotent: permission and grants are upserts.
 *
 * Run:  pnpm db:seed:lead-performance
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

const PERMISSION = {
  key: "reports.lead_performance.view",
  label: "View Lead Performance by Staff Member",
};

/**
 * Scope per role, mirroring the grants block in prisma/seed.ts.
 *
 * `counsellor` is deliberately absent: the report names individuals and their conversion
 * numbers, and whether a rep may see their colleagues' figures is a management decision
 * rather than a default. A counsellor already sees their own work through My Work and the
 * pipeline's "Assigned to me" filter. Grant it to them from Admin ▸ Roles if you want an
 * open scoreboard.
 */
const GRANTS: ReadonlyArray<{ roleKey: string; scope: RolePermissionScope }> = [
  { roleKey: "super_admin", scope: RolePermissionScope.all },
  { roleKey: "admin", scope: RolePermissionScope.all },
  // Marketing owns lead generation end to end here and already holds tenant-wide
  // `leads.*`, so they see the whole team's throughput.
  { roleKey: "marketing", scope: RolePermissionScope.all },
  // A branch manager sees the reps posted to their branch(es), and those branches' leads.
  { roleKey: "branch_manager", scope: RolePermissionScope.branch },
];

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG, deletedAt: null } });
  if (!tenant) throw new Error(`[seed-lead-performance] tenant "${TENANT_SLUG}" not found`);

  const permission = await prisma.permission.upsert({
    where: { key: PERMISSION.key },
    update: { label: PERMISSION.label },
    create: { key: PERMISSION.key, label: PERMISSION.label },
  });

  let grantsWritten = 0;
  for (const { roleKey, scope } of GRANTS) {
    const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: roleKey } });
    if (!role) {
      // eslint-disable-next-line no-console
      console.warn(`[seed-lead-performance] role "${roleKey}" not found — skipping its grant`);
      continue;
    }
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: { scope },
      create: { roleId: role.id, permissionId: permission.id, scope },
    });
    grantsWritten += 1;
  }

  /* eslint-disable no-console */
  console.log(`[seed-lead-performance] permission "${PERMISSION.key}" upserted, ${grantsWritten} role grants written`);
  console.log("[seed-lead-performance] done — CRM ▸ Analytics ▸ Team Performance is now reachable");
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
