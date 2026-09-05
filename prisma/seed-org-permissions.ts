/**
 * seed-org-permissions.ts — the READ half of the org chart, and nothing else.
 *
 * A deliberate SUBSET of `seed-org.ts`. That script is the full P17 rollout: it also creates
 * the `hr` role, hands `leave.approve` to every staff role, widens two reporting keys, and
 * NARROWS `leave.calendar.view` from company-wide to own-team for ~10 staff accounts. All of
 * that is correct and intended eventually — but it is a change to other people's access, and
 * it should be a decision somebody makes on purpose rather than the price of unblocking one
 * screen.
 *
 * This script exists because of the way the gap showed up: on a database where P17's
 * migration had run but its seed had not, `org.teams.view` did not exist as a permission row
 * at all, so nobody held it — including the owner. CRM ▸ Organisation appeared in the sidebar
 * (the section declares no permission of its own; the gate is on its single child) and opened
 * a panel reading "Nothing here for your role". A super admin being told a screen is not for
 * their role is the clearest possible signal that the permission data, not the code, is wrong.
 *
 * WHAT IT WRITES — the two permission rows, and the four grants that make the org chart
 * readable and editable by the people who already run the company:
 *
 *   org.teams.view    -> super_admin, admin, branch_manager   (reading the chart is information)
 *   org.teams.manage  -> super_admin                          (editing it is authority)
 *
 * `org.teams.manage` stays narrow for the reason ADR-0069 gives: the hierarchy is DATA and
 * the leave rule is uniform, so whoever can edit a team decides who signs off whose absence.
 * `admin` gets the read and not the write, exactly as it gets neither `leave.approve` nor
 * `leave.manage`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: create the `hr` role, grant anything to it, touch
 * `leave.*`, or change any scope that already exists. Run `pnpm db:seed:org` when the rest of
 * P17 is wanted — it is idempotent and will layer cleanly on top of this.
 *
 * Idempotent: every write is an upsert, and a grant that already exists at the right scope is
 * left alone. Safe to re-run.
 *
 * Run:  pnpm db:seed:org-permissions
 *
 * Run it AFTER `prisma migrate deploy` has applied `20260901100000_org_hierarchy_teams`
 * (which creates `teams` and adds `users.team_id`) — without it the screen renders and every
 * query 500s.
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

const PERMISSIONS = [
  { key: "org.teams.view", label: "View Teams & Reporting Lines" },
  { key: "org.teams.manage", label: "Create & Edit Teams, Managers and Team Leads" },
] as const;

/**
 * `branch_manager` gets the read for the reason `seed-org.ts` gives: somebody running a
 * centre needs to see who reports to whom in it, and must not be able to rewrite the lines.
 * It is listed even though no account currently holds that role — a grant is about the role,
 * not about who happens to be in it today.
 */
const GRANTS: Array<{ roleKey: string; permissionKey: string; scope: RolePermissionScope }> = [
  { roleKey: "super_admin", permissionKey: "org.teams.view", scope: RolePermissionScope.all },
  { roleKey: "admin", permissionKey: "org.teams.view", scope: RolePermissionScope.all },
  { roleKey: "branch_manager", permissionKey: "org.teams.view", scope: RolePermissionScope.all },
  { roleKey: "super_admin", permissionKey: "org.teams.manage", scope: RolePermissionScope.all },
];

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(`[seed-org-permissions] tenant "${TENANT_SLUG}" not found — run the base seed first.`);
  }

  const permissionIds = new Map<string, string>();
  for (const perm of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: perm.key },
      update: { label: perm.label },
      create: { key: perm.key, label: perm.label },
    });
    permissionIds.set(perm.key, row.id);
    console.log(`[seed-org-permissions] permission ${perm.key}`);
  }

  for (const grant of GRANTS) {
    const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: grant.roleKey } });
    if (!role) {
      // Not fatal: a tenant without this role simply has nobody to grant it to. Same posture
      // as seed-org.ts — a missing role is a configuration fact, not a failure.
      console.warn(`[seed-org-permissions] role "${grant.roleKey}" not found — skipped.`);
      continue;
    }
    const permissionId = permissionIds.get(grant.permissionKey)!;
    const existing = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role.id, permissionId } },
      select: { scope: true },
    });
    if (existing?.scope === grant.scope) {
      console.log(`[seed-org-permissions] ${grant.roleKey} already has ${grant.permissionKey} (${existing.scope})`);
      continue;
    }
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId } },
      update: { scope: grant.scope },
      create: { roleId: role.id, permissionId, scope: grant.scope },
    });
    console.log(`[seed-org-permissions] granted ${grant.permissionKey} to ${grant.roleKey} (scope=${grant.scope})`);
  }

  console.log(
    "[seed-org-permissions] done. CRM ▸ Organisation ▸ Teams is now readable by super_admin, " +
      "admin and branch_manager, and editable by super_admin. No teams were created. " +
      "Run pnpm db:seed:org for the rest of P17 (hr role, two-step leave approval).",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
