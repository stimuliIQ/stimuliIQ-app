/**
 * seed-attempts-grade.ts — registers the `attempts.grade` permission on an EXISTING database.
 *
 * `attempts.grade` gates PUT /crm/attempts/:id/grade (assessments-crm.controller.ts), the route
 * a reviewer uses to grade a DESCRIPTIVE assessment attempt — the one attempt kind that cannot
 * be auto-scored, so without this route the answer is submitted and then never marked.
 *
 * WHY THIS IS NEEDED AT ALL: the key shipped on the route but was missing from the P4 catalog in
 * prisma/seed.ts, and a permission absent from the `permissions` table can be granted to nobody,
 * so the endpoint 403s for EVERYONE — including super_admin. Fail-closed, so a functional gap
 * rather than a security hole, but descriptive-attempt grading is simply dead until this runs.
 * (The whole integration suite hid it: p4-learning-depth-journey creates the permission as its
 * own fixture, so any DB the suite had touched already had the key.)
 *
 * Deliberately separate from `prisma/seed.ts`, for the same reason seed-user-delete.ts and
 * seed-onboarding.ts are: the full seed is a dev-fixture script that upserts demo students,
 * programs and campaigns, so running it against a live database would inject demo data into a
 * real catalog. This script writes ONLY the one permission and its grants.
 *
 * GRANTS — mirrors `submissions.grade`, whose reviewer surface this is:
 *   faculty                → scope=assigned  (grade within their own batches)
 *   admin, super_admin     → scope=all       (mirrors the seed's catch-all catalog grant)
 *
 * Idempotent: the permission and every grant are upserts.
 *
 * Run:  pnpm db:seed:attempts-grade
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

const PERMISSION = { key: "attempts.grade", label: "Grade Assessment Attempt" };

const GRANTS: Array<{ roleKey: string; scope: RolePermissionScope }> = [
  { roleKey: "faculty", scope: RolePermissionScope.assigned },
  { roleKey: "admin", scope: RolePermissionScope.all },
  { roleKey: "super_admin", scope: RolePermissionScope.all },
];

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG, deletedAt: null } });
  if (!tenant) throw new Error(`[seed-attempts-grade] tenant "${TENANT_SLUG}" not found`);

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
      console.warn(`[seed-attempts-grade] role "${roleKey}" not found — skipping its grant`);
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
  console.log(`[seed-attempts-grade] permission "${PERMISSION.key}" upserted, ${grantsWritten} role grants written`);
  console.log("[seed-attempts-grade] done — descriptive-attempt grading now reachable for faculty/admin/super_admin");
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
