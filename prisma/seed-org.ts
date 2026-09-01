/**
 * seed-org.ts — stands up the org hierarchy (teams, managers, team leads, HR) on an
 * EXISTING database. Spec: docs/specs/org-teams.md, ADR-0069.
 *
 * Deliberately separate from `prisma/seed.ts`, for the same reason `seed-marketing-targets.ts`,
 * `seed-careers.ts`, `seed-leave.ts` and `seed-onboarding.ts` are: the full seed is a
 * dev-fixture script that upserts demo students, sample programs and campaigns, so running
 * it against a live database injects fake data into a real catalog. This script writes ONLY
 * what the feature needs in order to function:
 *
 *   1. the two `org.teams.*` permissions
 *   2. the `hr` role
 *   3. the role grants
 *
 * NO TEAMS ARE SEEDED, and NOBODY IS PUT ON ONE, and NOBODY IS GIVEN THE `hr` ROLE — the
 * same judgement `seed-careers.ts` makes about sample job openings and `seed-leave.ts` makes
 * about public holidays, only sharper. A seeded team is not placeholder data: it is a live
 * approval route for real people's absence. A wrong one fails silently in the direction
 * nobody checks — somebody's leave gets signed off by a person who is not their manager, and
 * it looks entirely normal on screen. Seeding `hr` onto an existing account is worse still:
 * it hands company-wide people permissions to somebody nobody chose.
 *
 * Staff build the org chart in CRM ▸ Organisation ▸ Teams.
 *
 * Idempotent and non-destructive: permissions, the role and the grants are all upserts. An
 * `hr` role that already exists is left exactly as it is — its name is never overwritten,
 * because a tenant may have renamed it.
 *
 * Run:  pnpm db:seed:org
 *       (ts-node --project prisma/tsconfig.seed.json prisma/seed-org.ts)
 *
 * Run it AFTER `prisma migrate deploy` has applied `20260901100000_org_hierarchy_teams`
 * (which creates `teams` and adds `users.team_id`).
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

/**
 * TWO keys, and the split is the whole design.
 *
 * `org.teams.view` is "who is my lead, and who is on my team?". It IS in the permission
 * catalog in `seed.ts`, so admin and super_admin inherit it via the catch-all — reading the
 * org chart is information, not authority, and a key held outside the catalog would have to
 * be remembered for every role that ever needs a team picker. Same call P16 made for
 * `course_types` reads being gated on `students.view`.
 *
 * `org.teams.manage` is NOT in the catalog, and that omission is the security keystone of
 * this whole phase. Because the hierarchy is DATA and the approval rule is uniform, whoever
 * can edit teams decides who signs off whose leave — authority equivalent to `leave.approve`,
 * and narrowed by the same device (a dedicated block outside the admin catch-all).
 */
const PERMISSIONS = [
  { key: "org.teams.view", label: "View Teams & Reporting Lines" },
  { key: "org.teams.manage", label: "Create & Edit Teams, Managers and Team Leads" },
] as const;

/**
 * The `hr` role.
 *
 * `isSystem: false` deliberately: `true` would make its permission matrix immutable through
 * the CRM (roles.service.ts refuses to edit a system role outright), and HR's grant set is
 * business policy that will change. The two system roles are the two that must never be
 * editable — super_admin and admin — and HR is not one of them.
 *
 * HR is NOT a node in the hierarchy. Its authority is company-wide by definition, so putting
 * it in the tree would mean every team needed an HR member and HR's power came from
 * membership. HR staff still get an ordinary team like anyone else, so their OWN leave has a
 * chain (it goes to the super admin — see resolveLeaveApprovalChain); their authority comes
 * from the role.
 */
const HR_ROLE = { key: "hr", name: "HR" } as const;

/**
 * Grants.
 *
 * Note what HR does NOT get, all deliberate:
 *   - `users.create` / `users.remove` / `users.reset_password` — creating and destroying
 *     login accounts is account administration, and `users.reset_password` in particular is
 *     already super_admin-only precisely because whoever holds it can take over a stronger
 *     account.
 *   - `roles.edit` — HR must not be able to grant itself more than this list.
 *   - `audit_logs.view` — oversight authority, not people administration.
 *   - anything from students / leads / commerce / content / settings.
 *
 * `org.teams.view` is granted explicitly to branch_manager as well: a branch manager runs a
 * centre and needs to see who reports to whom in it, but must not be able to rewrite the
 * reporting lines.
 */
const GRANTS: Array<{ roleKey: string; permissionKey: string; scope: RolePermissionScope }> = [
  // Reading the org chart. admin and super_admin are listed EXPLICITLY even though
  // `org.teams.view` is in seed.ts's catalog (which grants the whole catalog to both): that
  // catch-all only runs in the full seed, and the full seed must never touch a live database.
  // Relying on it here would ship a live tenant whose admins cannot open the screen.
  { roleKey: "super_admin", permissionKey: "org.teams.view", scope: RolePermissionScope.all },
  { roleKey: "admin", permissionKey: "org.teams.view", scope: RolePermissionScope.all },
  { roleKey: "hr", permissionKey: "org.teams.view", scope: RolePermissionScope.all },
  { roleKey: "branch_manager", permissionKey: "org.teams.view", scope: RolePermissionScope.all },
  // Editing it — HR and the owner only.
  { roleKey: "hr", permissionKey: "org.teams.manage", scope: RolePermissionScope.all },
  { roleKey: "super_admin", permissionKey: "org.teams.manage", scope: RolePermissionScope.all },
  // HR's people-administration surface.
  { roleKey: "hr", permissionKey: "users.view", scope: RolePermissionScope.all },
  { roleKey: "hr", permissionKey: "roles.view", scope: RolePermissionScope.all },
  // HR's leave surface: they hold company-wide leave authority, which is what makes them the
  // fallback approver for anyone not yet on the org chart.
  { roleKey: "hr", permissionKey: "leave.view", scope: RolePermissionScope.all },
  { roleKey: "hr", permissionKey: "leave.request", scope: RolePermissionScope.own },
  { roleKey: "hr", permissionKey: "leave.calendar.view", scope: RolePermissionScope.all },
  { roleKey: "hr", permissionKey: "leave.approve", scope: RolePermissionScope.all },
  { roleKey: "hr", permissionKey: "leave.manage", scope: RolePermissionScope.all },
];

/**
 * `leave.approve`, granted UNIFORMLY to every staff role at scope=own.
 *
 * This is the half of the design that makes appointing a team lead a one-step act. The
 * permission says "you may act on the approvals endpoint at all"; WHOSE requests you can
 * see and act on is decided entirely by the org chart. A staff member who leads no team
 * resolves to an empty set of subordinates: their queue holds only their own requests, and
 * any attempt to decide one is refused twice over — 404 for a request they have no standing
 * over, and 403 `leave.self_review` for their own.
 *
 * The alternative — a dedicated `team_lead` role granted per person — was rejected because
 * a person's position would then live in TWO places, the role and the team, and those two
 * drift. Somebody appoints a lead in Organisation ▸ Teams, forgets the role, and the lead
 * quietly cannot approve anything. Data-only is one place.
 *
 * `admin` is NOT here, and neither is `student` or `mentor`. Admin's exclusion is the
 * invariant leave.permission-catalog.spec.ts pins; mentors are external hires, not staff on
 * the payroll this runs for.
 */
/**
 * The keys a team lead or manager needs to see THEIR OWN PEOPLE on the three reporting
 * surfaces, all granted at scope=own for the same reason `leave.approve` is: the permission
 * says you may open the screen, the ORG CHART decides whose numbers are on it.
 *
 * Somebody who leads nobody gets an empty screen with a named empty state — never a 403 on
 * a page the sidebar just offered them, which is what gets reported as "the CRM is broken".
 *
 * `reports.lead_performance.view` is the one key here that ALREADY EXISTS at other scopes
 * (branch_manager holds `branch`, marketing holds `all`). `grant()` upserts and UPDATES the
 * scope, so those two roles are excluded below — re-granting would DOWNGRADE them and
 * silently shrink a report they rely on.
 */
const TEAM_REPORT_KEYS = ["marketing_targets.manage", "reports.lead_performance.view"] as const;

/** Roles that already hold a report key at a WIDER scope and must not be downgraded. */
const DO_NOT_DOWNGRADE: Record<string, readonly string[]> = {
  "reports.lead_performance.view": ["branch_manager", "marketing"],
};

const STAFF_APPROVER_ROLES = [
  "branch_manager",
  "counsellor",
  "faculty",
  "finance",
  "marketing",
  "support",
  "content_editor",
] as const;

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    throw new Error(`[seed-org] tenant "${TENANT_SLUG}" not found — run the base seed first.`);
  }

  // ── Permissions ────────────────────────────────────────────────────────────
  const permissions = new Map<string, string>();
  for (const perm of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: perm.key },
      update: { label: perm.label },
      create: { key: perm.key, label: perm.label },
    });
    permissions.set(perm.key, row.id);
    console.log(`[seed-org] permission ${perm.key}`);
  }

  // ── The hr role ────────────────────────────────────────────────────────────
  const existingHr = await prisma.role.findFirst({
    where: { tenantId: tenant.id, key: HR_ROLE.key },
  });
  if (existingHr) {
    console.log(`[seed-org] role "${HR_ROLE.key}" already exists — left untouched.`);
  } else {
    await prisma.role.create({
      data: { tenantId: tenant.id, key: HR_ROLE.key, name: HR_ROLE.name, isSystem: false },
    });
    console.log(`[seed-org] created role "${HR_ROLE.key}"`);
  }

  // ── Grants ─────────────────────────────────────────────────────────────────
  for (const grant of GRANTS) {
    const role = await prisma.role.findFirst({
      where: { tenantId: tenant.id, key: grant.roleKey },
    });
    if (!role) {
      // Not fatal: a tenant with no branch_manager role simply has nobody to grant the
      // org-chart read to, and the feature stays dormant rather than the script dying.
      console.warn(`[seed-org] role "${grant.roleKey}" not found — skipped.`);
      continue;
    }

    // A permission this script did not create (leave.*, users.view, roles.view) must already
    // exist from the base seed. Look it up rather than upserting a label we would then own.
    let permissionId = permissions.get(grant.permissionKey);
    if (!permissionId) {
      const found = await prisma.permission.findUnique({ where: { key: grant.permissionKey } });
      if (!found) {
        console.warn(`[seed-org] permission "${grant.permissionKey}" not found — skipped.`);
        continue;
      }
      permissionId = found.id;
    }

    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId } },
      update: { scope: grant.scope },
      create: { roleId: role.id, permissionId, scope: grant.scope },
    });
    console.log(`[seed-org] granted ${grant.permissionKey} to ${grant.roleKey} (scope=${grant.scope})`);
  }

  // ── leave.approve for every staff role ─────────────────────────────────────
  const approvePermission = await prisma.permission.findUnique({ where: { key: "leave.approve" } });
  if (!approvePermission) {
    console.warn('[seed-org] permission "leave.approve" not found — run pnpm db:seed:leave first.');
  } else {
    for (const roleKey of STAFF_APPROVER_ROLES) {
      const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: roleKey } });
      if (!role) {
        console.warn(`[seed-org] role "${roleKey}" not found — skipped.`);
        continue;
      }
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: approvePermission.id } },
        update: { scope: RolePermissionScope.own },
        create: { roleId: role.id, permissionId: approvePermission.id, scope: RolePermissionScope.own },
      });
      console.log(`[seed-org] granted leave.approve to ${roleKey} (scope=own — the org chart decides whose)`);
    }
  }

  // ── leave.calendar.view NARROWED from all to own ───────────────────────────
  //
  // The one grant in this script that TAKES something away, and the only reason it is here
  // is that an existing database still holds the P13 posture. Until the org chart landed,
  // every staff role held this key at scope=all: any member of staff could read every
  // colleague's absences, and the CRM's team/company toggle was a convenience sitting on top
  // of a view that showed everything rather than a boundary.
  //
  // `LeaveService.getCalendar` reads the scope now — `own` means yourself PLUS the people
  // you approve for, resolved from the org chart, with no request that widens it. A database
  // seeded before P17 keeps `all` and therefore keeps the old, wider view, and nothing on
  // screen looks wrong: the calendar simply shows more people than it should. `prisma/seed.ts`
  // already grants `own` on a fresh database; this is the same narrowing for a live one.
  //
  // `admin`, `super_admin` and `hr` are NOT in STAFF_APPROVER_ROLES, so their scope=all is
  // untouched — which is the point, since they are the roles that must still see everybody.
  const calendarPermission = await prisma.permission.findUnique({ where: { key: "leave.calendar.view" } });
  if (!calendarPermission) {
    console.warn('[seed-org] permission "leave.calendar.view" not found — run pnpm db:seed:leave first.');
  } else {
    for (const roleKey of STAFF_APPROVER_ROLES) {
      const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: roleKey } });
      if (!role) continue;
      const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: calendarPermission.id } },
        select: { scope: true },
      });
      if (!existing) {
        // Never GRANTS the key to a role that does not hold it. Which roles may open the
        // calendar at all is a policy decision this script has no business making; it only
        // narrows one that is already there.
        continue;
      }
      if (existing.scope === RolePermissionScope.own) continue;
      await prisma.rolePermission.update({
        where: { roleId_permissionId: { roleId: role.id, permissionId: calendarPermission.id } },
        data: { scope: RolePermissionScope.own },
      });
      console.log(
        `[seed-org] narrowed leave.calendar.view for ${roleKey} (${existing.scope} -> own — they now see themselves plus the people they approve for)`,
      );
    }
  }

  // ── Team-scoped reporting keys ─────────────────────────────────────────────
  for (const key of TEAM_REPORT_KEYS) {
    const permission = await prisma.permission.findUnique({ where: { key } });
    if (!permission) {
      console.warn(`[seed-org] permission "${key}" not found — skipped.`);
      continue;
    }
    for (const roleKey of STAFF_APPROVER_ROLES) {
      if ((DO_NOT_DOWNGRADE[key] ?? []).includes(roleKey)) {
        console.log(`[seed-org] ${key}: left ${roleKey} at its existing wider scope`);
        continue;
      }
      const role = await prisma.role.findFirst({ where: { tenantId: tenant.id, key: roleKey } });
      if (!role) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: { scope: RolePermissionScope.own },
        create: { roleId: role.id, permissionId: permission.id, scope: RolePermissionScope.own },
      });
      console.log(`[seed-org] granted ${key} to ${roleKey} (scope=own — the org chart decides whose)`);
    }
  }

  console.log(
    "[seed-org] done. No teams were created and nobody was given the hr role — " +
      "build the org chart in CRM ▸ Organisation ▸ Teams, then assign hr in Admin ▸ Users.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
