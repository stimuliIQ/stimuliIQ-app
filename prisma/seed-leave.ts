/**
 * seed-leave.ts — stands up staff leave management on an EXISTING database.
 *
 * Deliberately separate from `prisma/seed.ts`. The full seed is a dev-fixture script: it
 * upserts sample students, demo programs, campaigns and forum threads, so running it against
 * a live database would inject demo data into a real catalog. This script writes ONLY what
 * the leave feature needs in order to function:
 *
 *   1. the five `leave.*` permissions + their role grants
 *   2. four default leave types (Casual / Sick / Earned / Unpaid)
 *   3. the working week — Sundays off
 *   4. this year's allowance for each paid type
 *
 * Idempotent and non-destructive by construction:
 *   - permissions/grants are upserts;
 *   - a leave type whose `key` already exists is SKIPPED, never updated — once staff have
 *     renamed "Casual Leave" or switched it to whole-days-only in the CRM, that row is
 *     theirs and re-running this must not revert their decision;
 *   - the working week and the year's allowances are written only if ABSENT, for the same
 *     reason. Overwriting an allowance mid-year would silently change what every staff
 *     member is entitled to.
 *
 * NO HOLIDAYS ARE SEEDED, on purpose. A public-holiday list is specific to a region, a
 * religion mix and a company, and there is no defensible default. Worse, a wrong seeded
 * holiday is invisible in the wrong direction: it makes leave across that date cost a day
 * less than it should, and nobody notices until the balances are audited. Staff enter them
 * in CRM ▸ Leave Management ▸ Setup ▸ Holidays.
 *
 * UNPAID LEAVE AND ALLOWANCES: `Leave Without Pay` is seeded with `paid: false` and gets no
 * allowance row. The service skips the balance check entirely for unpaid types — there is
 * nothing to run out of — so an absent quota there is correct rather than an omission.
 *
 * Run:  pnpm db:seed:leave
 *       (ts-node --project prisma/tsconfig.seed.json prisma/seed-leave.ts)
 */
import { PrismaClient, RolePermissionScope } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "stimuliiq";

/**
 * `leave.approve` and `leave.manage` are separate from the three read/apply keys on purpose,
 * and they go to super_admin ALONE — not to admin. Signing off on somebody's leave and
 * setting the yearly allowance are the owner's calls (docs/specs/leave-management.md).
 *
 * `leave.calendar.view` is separate from `leave.view` for a different reason: its endpoint
 * returns a projection with NO reason field, so seeing WHEN a colleague is out never becomes
 * reading WHY.
 *
 * Its SCOPE changed on 2026-09-01. It was `all` for every staff role, which meant anyone
 * could read the whole company's absence pattern. It is now `own` for staff and `all` only
 * for super_admin / admin / hr; the service resolves `own` against the org chart, so a
 * rank-and-file member sees strictly their own leave and a lead or manager sees the people
 * they approve for.
 */
const PERMISSIONS = [
  { key: "leave.view", label: "View Leave Requests" },
  { key: "leave.request", label: "Apply For / Cancel Own Leave" },
  { key: "leave.calendar.view", label: "View the Team Leave Calendar" },
  { key: "leave.approve", label: "Approve / Reject Staff Leave" },
  { key: "leave.manage", label: "Manage Leave Types, Allowances, Holidays & Weekly Offs" },
] as const;

type PermissionKey = (typeof PERMISSIONS)[number]["key"];

/**
 * Note the scope on each grant, not just the key — `own` versus `all` is what separates
 * "my leave" from the approver's queue, and getting it wrong is not a visible failure, it is
 * a quiet data leak. Every staff role reads the calendar at `all` and everything else at
 * `own`; only super_admin sees other people's requests.
 *
 * `admin` deliberately does NOT receive `leave.approve` or `leave.manage`.
 * `student` and `mentor` receive nothing — neither is staff with a leave allowance.
 */
const ROLE_GRANTS: Record<string, ReadonlyArray<[PermissionKey, RolePermissionScope]>> = {
  super_admin: [
    ["leave.view", RolePermissionScope.all],
    ["leave.request", RolePermissionScope.all],
    // COMPANY-WIDE, unlike every staff role below. The owner and admin need the whole
    // picture; everybody else sees only themselves plus whoever they approve for, which the
    // service resolves from the org chart.
    ["leave.calendar.view", RolePermissionScope.all],
    ["leave.approve", RolePermissionScope.all],
    ["leave.manage", RolePermissionScope.all],
  ],
  admin: [
    ["leave.view", RolePermissionScope.all],
    ["leave.request", RolePermissionScope.all],
    ["leave.calendar.view", RolePermissionScope.all],
  ],
  branch_manager: [
    ["leave.view", RolePermissionScope.own],
    ["leave.request", RolePermissionScope.own],
    ["leave.calendar.view", RolePermissionScope.own],
  ],
  counsellor: [
    ["leave.view", RolePermissionScope.own],
    ["leave.request", RolePermissionScope.own],
    ["leave.calendar.view", RolePermissionScope.own],
  ],
  faculty: [
    ["leave.view", RolePermissionScope.own],
    ["leave.request", RolePermissionScope.own],
    ["leave.calendar.view", RolePermissionScope.own],
  ],
  finance: [
    ["leave.view", RolePermissionScope.own],
    ["leave.request", RolePermissionScope.own],
    ["leave.calendar.view", RolePermissionScope.own],
  ],
  marketing: [
    ["leave.view", RolePermissionScope.own],
    ["leave.request", RolePermissionScope.own],
    ["leave.calendar.view", RolePermissionScope.own],
  ],
  support: [
    ["leave.view", RolePermissionScope.own],
    ["leave.request", RolePermissionScope.own],
    ["leave.calendar.view", RolePermissionScope.own],
  ],
  content_editor: [
    ["leave.view", RolePermissionScope.own],
    ["leave.request", RolePermissionScope.own],
    ["leave.calendar.view", RolePermissionScope.own],
  ],
};

/**
 * Starting categories, in the order they appear on the apply form. `allowanceDays` is what
 * this script writes into the CURRENT year's allowance if none exists yet; it is not a
 * property of the type, which is why it lives here and not on the row.
 *
 * These carry no special status once inserted: they are ordinary rows staff rename, reorder,
 * deactivate or delete from CRM ▸ Leave Management ▸ Setup.
 */
const LEAVE_TYPES = [
  {
    key: "casual",
    name: "Casual Leave",
    description: "Short, planned time off — errands, family commitments, a day away.",
    paid: true,
    allowHalfDay: true,
    allowanceDays: 12,
  },
  {
    key: "sick",
    name: "Sick Leave",
    description: "Illness or a medical appointment. No details needed beyond the dates.",
    paid: true,
    allowHalfDay: true,
    allowanceDays: 6,
  },
  {
    key: "earned",
    name: "Earned Leave",
    description: "Longer planned breaks and holidays. Apply well ahead where you can.",
    paid: true,
    allowHalfDay: false,
    allowanceDays: 12,
  },
  {
    key: "unpaid",
    name: "Leave Without Pay",
    description: "Time off beyond your paid allowance, agreed with the super admin.",
    paid: false,
    allowHalfDay: true,
    allowanceDays: null,
  },
] as const;

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG, deletedAt: null } });
  if (!tenant) throw new Error(`[seed-leave] tenant "${TENANT_SLUG}" not found`);

  // ── Permissions + grants ────────────────────────────────────────────────
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
        console.warn(`[seed-leave] role "${roleKey}" not found — skipping its grants`);
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

  // ── Leave types ─────────────────────────────────────────────────────────
  let typesCreated = 0;
  let typesSkipped = 0;
  const typeIdByKey = new Map<string, string>();

  for (const [index, def] of LEAVE_TYPES.entries()) {
    const existing = await prisma.leaveType.findFirst({
      where: { tenantId: tenant.id, key: def.key, deletedAt: null },
    });
    if (existing) {
      typeIdByKey.set(def.key, existing.id);
      typesSkipped += 1; // Staff own this row now — never overwrite their edits.
      continue;
    }
    const created = await prisma.leaveType.create({
      data: {
        tenantId: tenant.id,
        key: def.key,
        name: def.name,
        description: def.description,
        paid: def.paid,
        allowHalfDay: def.allowHalfDay,
        active: true,
        sortOrder: index,
      },
    });
    typeIdByKey.set(def.key, created.id);
    typesCreated += 1;
  }

  // ── Working week ────────────────────────────────────────────────────────
  // Sundays off. Written only if no configuration exists — a tenant that has already set a
  // six- or five-day week has answered this question, and re-running must not un-answer it.
  const existingSetting = await prisma.leaveSetting.findFirst({
    where: { tenantId: tenant.id, deletedAt: null },
  });
  if (!existingSetting) {
    await prisma.leaveSetting.create({ data: { tenantId: tenant.id, weeklyOffDays: [0] } });
  }

  // ── This year's allowances ──────────────────────────────────────────────
  // Only for paid types, and only where the year has no allowance yet. Overwriting one
  // mid-year would silently change what everybody is entitled to.
  const year = new Date().getUTCFullYear();
  let quotasCreated = 0;
  let quotasSkipped = 0;

  for (const def of LEAVE_TYPES) {
    if (def.allowanceDays === null) continue;
    const leaveTypeId = typeIdByKey.get(def.key);
    if (!leaveTypeId) continue;

    const existing = await prisma.leaveQuota.findFirst({
      where: { tenantId: tenant.id, leaveTypeId, year, deletedAt: null },
    });
    if (existing) {
      quotasSkipped += 1;
      continue;
    }
    await prisma.leaveQuota.create({
      data: { tenantId: tenant.id, leaveTypeId, year, halfDays: def.allowanceDays * 2 },
    });
    quotasCreated += 1;
  }

  /* eslint-disable no-console */
  console.log(`[seed-leave] permissions: ${PERMISSIONS.length} upserted, ${grantsWritten} role grants written`);
  console.log(`[seed-leave] leave types: ${typesCreated} created, ${typesSkipped} already present (left untouched)`);
  console.log(`[seed-leave] working week: ${existingSetting ? "already configured (left untouched)" : "Sundays off"}`);
  console.log(`[seed-leave] ${year} allowances: ${quotasCreated} created, ${quotasSkipped} already present`);
  console.log(`[seed-leave] holidays: none seeded by design — add them in CRM ▸ Leave Management ▸ Setup`);
  console.log(`[seed-leave] done`);
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[seed-leave] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
