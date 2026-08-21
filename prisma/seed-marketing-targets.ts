/**
 * seed-marketing-targets.ts — stands up monthly marketing targets on an EXISTING database.
 * Spec: docs/specs/marketing-targets.md, ADR-0067.
 *
 * Deliberately separate from `prisma/seed.ts`, for the same reason `seed-careers.ts`,
 * `seed-leave.ts` and `seed-onboarding.ts` are: the full seed is a dev-fixture script that
 * upserts demo students, sample programs and campaigns, so running it against a live
 * database injects fake data into a real catalog. This script writes ONLY the two things
 * the feature needs in order to function:
 *
 *   1. the two `marketing_targets.*` permissions
 *   2. their role grants
 *
 * NO TARGETS ARE SEEDED, on purpose — the same judgement `seed-careers.ts` makes about
 * sample job openings and `seed-leave.ts` makes about public holidays. A seeded target is
 * not placeholder data: it is a number a real person is measured against, appearing on
 * their dashboard, attributed to whoever this script ran as. Worse, a WRONG seeded target
 * fails silently in the direction nobody checks, by making somebody look like they are
 * missing a goal that nobody set. The super admin sets the first target in
 * CRM ▸ Marketing ▸ Targets.
 *
 * Idempotent and non-destructive: permissions and grants are upserts, and there is nothing
 * else to write.
 *
 * Run:  pnpm db:seed:marketing-targets
 *       (ts-node --project prisma/tsconfig.seed.json prisma/seed-marketing-targets.ts)
 *
 * Run it AFTER `prisma migrate deploy` has applied `20260821100000_marketing_targets`
 * (which creates `marketing_targets` and adds `leads.converted_at`).
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

/**
 * TWO keys, and the split is the whole design.
 *
 * `marketing_targets.view` is "what am I being measured on?", held by the MARKETING role at
 * scope=own. The endpoint behind it (`GET /crm/marketing-targets/me`) takes no user id at
 * all — the subject is always the session user — so scope=own is the entire gate and there
 * is no id to tamper with.
 *
 * `marketing_targets.manage` is "what should this person's number be?", plus the team
 * report. super_admin ALONE, exactly like `leave.approve`: deciding the number somebody is
 * judged against is the owner's call.
 *
 * NEITHER key belongs to the permission catalog in `seed.ts`, and that omission is load
 * bearing — the catalog is what the admin+super_admin catch-all loop iterates, so catalog
 * membership would hand BOTH keys to every operational admin without anyone deciding to.
 */
const PERMISSIONS = [
  { key: "marketing_targets.view", label: "View Own Marketing Target" },
  { key: "marketing_targets.manage", label: "Set & Report on Marketing Targets" },
] as const;

/**
 * Note the deliberate asymmetry, which is NOT an oversight:
 *   marketing   gets `view`   but not `manage` — they read their own card, they do not set it
 *   super_admin gets `manage` but not `view`   — they have no marketing target of their own,
 *                                                and the team report IS their surface
 * Granting super_admin `view` would put a permanently-empty "My target" card on the owner's
 * dashboard forever.
 */
const GRANTS: Array<{ roleKey: string; permissionKey: string; scope: RolePermissionScope }> = [
  { roleKey: "marketing", permissionKey: "marketing_targets.view", scope: RolePermissionScope.own },
  { roleKey: "super_admin", permissionKey: "marketing_targets.manage", scope: RolePermissionScope.all },
];

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(`[seed-marketing-targets] tenant "${TENANT_SLUG}" not found — run the base seed first.`);
  }

  const permissions = new Map<string, string>();
  for (const perm of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: perm.key },
      update: { label: perm.label },
      create: { key: perm.key, label: perm.label },
    });
    permissions.set(perm.key, row.id);
    console.log(`[seed-marketing-targets] permission ${perm.key}`);
  }

  for (const grant of GRANTS) {
    const role = await prisma.role.findFirst({
      where: { tenantId: tenant.id, key: grant.roleKey },
    });
    if (!role) {
      // Not fatal: a tenant that has never created a marketing role simply has nobody to
      // grant `view` to, and the feature stays dormant rather than the script dying.
      console.warn(`[seed-marketing-targets] role "${grant.roleKey}" not found — skipped.`);
      continue;
    }
    const permissionId = permissions.get(grant.permissionKey);
    if (!permissionId) throw new Error(`[seed-marketing-targets] missing permission ${grant.permissionKey}`);

    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId } },
      update: { scope: grant.scope },
      create: { roleId: role.id, permissionId, scope: grant.scope },
    });
    console.log(
      `[seed-marketing-targets] granted ${grant.permissionKey} to ${grant.roleKey} (scope=${grant.scope})`,
    );
  }

  console.log("[seed-marketing-targets] done. No targets were created — set the first one in CRM ▸ Marketing ▸ Targets.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
