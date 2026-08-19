/**
 * seed-careers.ts — stands up hiring (job openings + application review) on an EXISTING
 * database. Spec: docs/specs/careers-hiring.md, ADR-0066.
 *
 * Deliberately separate from `prisma/seed.ts`, for the same reason `seed-leave.ts` and
 * `seed-onboarding.ts` are: the full seed is a dev-fixture script that upserts demo
 * students, sample programs and campaigns, so running it against a live database injects
 * fake data into a real catalog. This script writes ONLY what the careers feature needs in
 * order to function:
 *
 *   1. the three `careers.*` permissions
 *   2. their role grants
 *
 * NO JOB OPENINGS ARE SEEDED, on purpose — and this is the same judgement `seed-leave.ts`
 * makes about public holidays. A sample opening is not harmless placeholder data: the
 * careers page renders published openings LIVE, so a seeded "Senior Counsellor — Vizag"
 * would be a real advert on a real website inviting real people to apply for a job that
 * does not exist. Staff create the first opening in CRM ▸ Careers ▸ Openings, where they
 * can see exactly what the public will read before they publish it.
 *
 * Idempotent and non-destructive: permissions and grants are upserts, and there is nothing
 * else to write.
 *
 * Run:  pnpm db:seed:careers
 *       (ts-node --project prisma/tsconfig.seed.json prisma/seed-careers.ts)
 *
 * Run it AFTER `prisma migrate deploy` has applied
 * `20260819140000_careers_openings_and_review` (which creates `job_openings` and adds the
 * review columns to `career_applications`).
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

/**
 * Careers does NOT reuse `content.*`, even though a job advert is marketing content and the
 * colleges screen right next to it does exactly that. The reason is `careers.view`: an
 * application carries a stranger's name, phone number, resume and cover letter, none of it
 * solicited. Whoever may rewrite the homepage should not thereby be able to read CVs.
 *
 * `careers.review` is separate from `careers.view` because every verb behind it emails a
 * real person. `careers.openings.manage` is separate from both because changing what the
 * public careers page advertises is a different privilege from working the queue — the same
 * split as `onboarding.fields.manage` versus `onboarding.view` (P12).
 */
const PERMISSIONS = [
  { key: "careers.view", label: "View Career Applications" },
  { key: "careers.review", label: "Decide Career Applications (hold/shortlist/offer/reject)" },
  { key: "careers.openings.manage", label: "Manage Job Openings" },
] as const;

type PermissionKey = (typeof PERMISSIONS)[number]["key"];

/**
 * scope=all throughout: an application arrives from an anonymous public form and carries no
 * branch to be partitioned by, so a narrowed scope has nothing to narrow BY. The service
 * fails closed on any scope other than `all` rather than silently widening it.
 *
 * `branch_manager` is the only non-admin role here, and it gets view + review but NOT
 * openings.manage: a branch manager is who actually interviews a counsellor or a faculty
 * hire for their centre, so making them wait on a super admin to hold or shortlist means
 * nobody touches the queue for a week — but what the public site advertises, and at what
 * compensation, stays with admin.
 *
 * Every other staff role receives nothing. Hiring is not a general-staff activity, and the
 * default for a queue full of other people's personal data is "no".
 */
const ROLE_GRANTS: Record<string, ReadonlyArray<[PermissionKey, RolePermissionScope]>> = {
  super_admin: [
    ["careers.view", RolePermissionScope.all],
    ["careers.review", RolePermissionScope.all],
    ["careers.openings.manage", RolePermissionScope.all],
  ],
  admin: [
    ["careers.view", RolePermissionScope.all],
    ["careers.review", RolePermissionScope.all],
    ["careers.openings.manage", RolePermissionScope.all],
  ],
  branch_manager: [
    ["careers.view", RolePermissionScope.all],
    ["careers.review", RolePermissionScope.all],
  ],
};

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG, deletedAt: null } });
  if (!tenant) throw new Error(`[seed-careers] tenant "${TENANT_SLUG}" not found`);

  let grantsWritten = 0;
  for (const perm of PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { key: perm.key },
      update: { label: perm.label },
      create: { key: perm.key, label: perm.label },
    });

    for (const [roleKey, grants] of Object.entries(ROLE_GRANTS)) {
      const entry = grants.find(([key]) => key === perm.key);
      if (!entry) continue;

      const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: roleKey } });
      if (!role) {
        // eslint-disable-next-line no-console
        console.warn(`[seed-careers] role "${roleKey}" not found — skipping its grants`);
        continue;
      }
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: { scope: entry[1], deletedAt: null },
        create: { roleId: role.id, permissionId: permission.id, scope: entry[1] },
      });
      grantsWritten += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[seed-careers] done — ${PERMISSIONS.length} permissions upserted, ${grantsWritten} role grants written.\n` +
      `[seed-careers] No job openings were seeded (see this file's header). ` +
      `Create the first one in CRM ▸ Careers ▸ Openings; it goes live on /careers the moment it is published.`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[seed-careers] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
