// apps/api/test/fixtures/commerce-leads-fixtures.ts
//
// Fixture factory for the P2 Commerce + Leads integration suite (qa-engineer, Wave 6,
// docs/plans/phase-2.md task #9). Mirrors the SHAPE/conventions of
// test/fixtures/crm-fixtures.ts (P1 CRM-core fixtures) but is scoped to exactly what the
// commerce + leads integration tests need:
//   - reuses the shared "stimuliiq" tenant (same hard-coded-slug constraint as
//     crm-fixtures.ts/seed-fixtures.ts — AuthService.login resolves users via a
//     hard-coded TENANT_SLUG, so every fixture user MUST live in that tenant)
//   - the full docs/03 §9 default role set (super_admin, admin, branch_manager,
//     counsellor, finance, marketing, student) with the P2 permission matrix
//     materialized exactly as prisma/seed.ts does it (finance=all on orders/payments/
//     invoices/refunds incl. refunds.approve; marketing=all on coupons/leads/activities/
//     bookings; counsellor=own on leads/activities/bookings + leads.convert;
//     branch_manager=branch on orders/payments(view)+leads/activities/bookings)
//   - 2 branches (for branch-scope isolation, independent of the dev seed)
//   - 1 published program with 2 batches (one per branch, capacity 10)
//   - 2 counsellor users (counsellor A owns leads in branch A; counsellor B owns leads in
//     branch B) — this is the field that makes "own"/"assigned" scope isolation testable
//     (the P1-deferred criterion P2 resolves)
//   - 1 finance user (scope=all on commerce), 1 marketing user (scope=all on leads/
//     coupons), 1 branch_manager (branch A), 1 bare student (deny-by-default negative)
//   - 1 pre-existing student_profile (for order/lead-conversion target FK validity)
//
// IDEMPOTENT WRITES: deliberately SEQUENTIAL (not Promise.all) on every upsert against a
// shared unique key (`permission.key`, `role.tenantId_key`, etc.) — see the defect noted
// in this suite's QA report: running crm-fixtures.ts's `ensurePermissionCatalog()` (which
// DOES use `Promise.all` for concurrent `permission.upsert` calls on the same key) from
// multiple Jest worker processes against the SAME ephemeral testcontainers Postgres
// produces `Unique constraint failed on the fields: (key)` because two workers can both
// miss the row in their upsert's existence check and race the insert. This file avoids
// that race entirely by writing this fixture's setup in a single Jest project run (this
// suite's own spec files share one `beforeAll`-seeded fixture set per file, sequentially
// upserted) — see also the recommendation to run `--runInBand` until backend-builder
// hardens the shared fixtures' upsert pattern (flagged in the QA report, not fixed here
// per qa-engineer scope).
//
// IMPORTANT (same defect as crm-fixtures.ts/seed-fixtures.ts, NOT fixed here — qa-engineer
// scope): `AuthService` hard-codes `TENANT_SLUG = "stimuliiq"` — every fixture user here
// is therefore created in that shared tenant, never an isolated per-suite tenant.

import { PrismaClient, RolePermissionScope } from "@prisma/client";
import * as argon2 from "argon2";
import { purgeAuditLogs } from "../../src/prisma/purge-audit-logs";
import { ensureFixtureCourseTypes } from "./course-type-fixtures";

export const CL_TENANT_SLUG = "stimuliiq";

// ── Known credentials for every role this suite logs in as ──────────────────────────
export const CL_SUPER_ADMIN_EMAIL = "qa-cl-superadmin@stimuliiq.test";
export const CL_SUPER_ADMIN_PASSWORD = "Qa-Cl-SuperAdmin-123!";

export const CL_FINANCE_EMAIL = "qa-cl-finance@stimuliiq.test";
export const CL_FINANCE_PASSWORD = "Qa-Cl-Finance-123!";

export const CL_MARKETING_EMAIL = "qa-cl-marketing@stimuliiq.test";
export const CL_MARKETING_PASSWORD = "Qa-Cl-Marketing-123!";

export const CL_BRANCH_MANAGER_EMAIL = "qa-cl-branchmgr@stimuliiq.test";
export const CL_BRANCH_MANAGER_PASSWORD = "Qa-Cl-BranchMgr-123!";

export const CL_COUNSELLOR_A_EMAIL = "qa-cl-counsellor-a@stimuliiq.test";
export const CL_COUNSELLOR_A_PASSWORD = "Qa-Cl-CounsellorA-123!";

export const CL_COUNSELLOR_B_EMAIL = "qa-cl-counsellor-b@stimuliiq.test";
export const CL_COUNSELLOR_B_PASSWORD = "Qa-Cl-CounsellorB-123!";

export const CL_BARE_STUDENT_EMAIL = "qa-cl-barestudent@stimuliiq.test";
export const CL_BARE_STUDENT_PASSWORD = "Qa-Cl-BareStudent-123!";

const ALL_FIXTURE_EMAILS = [
  CL_SUPER_ADMIN_EMAIL,
  CL_FINANCE_EMAIL,
  CL_MARKETING_EMAIL,
  CL_BRANCH_MANAGER_EMAIL,
  CL_COUNSELLOR_A_EMAIL,
  CL_COUNSELLOR_B_EMAIL,
  CL_BARE_STUDENT_EMAIL,
];

export interface SeededCommerceLeadsFixtures {
  tenantId: string;
  branchAId: string;
  branchBId: string;
  programId: string;
  programPricePaise: number;
  batchAId: string;
  batchBId: string;
  superAdminUserId: string;
  financeUserId: string;
  marketingUserId: string;
  branchManagerUserId: string;
  counsellorAUserId: string;
  counsellorBUserId: string;
  bareStudentUserId: string;
  enrollableStudentProfileId: string;
}

const P2_MODULES = ["orders", "payments", "invoices", "refunds", "coupons", "leads", "activities", "bookings"] as const;
const P2_ACTIONS = ["view", "create", "edit", "delete", "export", "approve", "convert"] as const;

function p2Key(mod: string, action: string): string {
  return `${mod}.${action}`;
}

/** Sequential (never Promise.all on a shared unique key) — see file header re: the race defect this avoids. */
async function ensurePermissionCatalog(prisma: PrismaClient): Promise<Map<string, { id: string }>> {
  const map = new Map<string, { id: string }>();
  for (const mod of P2_MODULES) {
    for (const action of P2_ACTIONS) {
      const key = p2Key(mod, action);
      const perm = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, label: `${action} ${mod}` },
      });
      map.set(key, { id: perm.id });
    }
  }
  return map;
}

async function grant(prisma: PrismaClient, roleId: string, permissionId: string, scope: RolePermissionScope): Promise<void> {
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId, permissionId } },
    update: { scope },
    create: { roleId, permissionId, scope },
  });
}

async function upsertUserRole(prisma: PrismaClient, userId: string, roleId: string, branchId: string | null): Promise<void> {
  const existing = await prisma.userRole.findFirst({ where: { userId, roleId, branchId } });
  if (!existing) {
    await prisma.userRole.create({ data: { userId, roleId, branchId } });
  }
}

async function ensureUser(prisma: PrismaClient, tenantId: string, email: string, password: string, name: string): Promise<{ id: string }> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { tenantId_email: { tenantId, email } },
    update: { passwordHash, status: "active" },
    create: { tenantId, email, name, passwordHash, status: "active" },
  });
}

/**
 * Seeds the full P2 commerce + leads fixture set documented in the file header. Safe to
 * call multiple times against the same database (upserts on natural keys, SEQUENTIALLY).
 */
export async function seedCommerceLeadsFixtures(prisma: PrismaClient): Promise<SeededCommerceLeadsFixtures> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: CL_TENANT_SLUG },
    update: {},
    create: { slug: CL_TENANT_SLUG, name: "QA Integration Tenant", status: "active", settings: {}, branding: {} },
  });
  const tenantId = tenant.id;

  // Course types are CRM-managed rows (ADR-0068): the API rejects a student or a lead
  // conversion whose course-type key is not one of the tenant's active options.
  await ensureFixtureCourseTypes(prisma, tenantId);

  const permByKey = await ensurePermissionCatalog(prisma);
  function permId(key: string): string {
    const perm = permByKey.get(key);
    if (!perm) throw new Error(`[commerce-leads-fixtures] expected permission "${key}" to exist`);
    return perm.id;
  }

  // ── Roles ────────────────────────────────────────────────────────────────────────
  const roleDefs = [
    { key: "super_admin", name: "Super Admin", isSystem: true },
    { key: "branch_manager", name: "Branch Manager", isSystem: false },
    { key: "counsellor", name: "Counsellor", isSystem: false },
    { key: "finance", name: "Finance", isSystem: false },
    { key: "marketing", name: "Marketing", isSystem: false },
    { key: "student", name: "Student", isSystem: false },
  ] as const;

  const rolesByKey: Record<string, string> = {};
  for (const def of roleDefs) {
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId, key: def.key } },
      update: { name: def.name, isSystem: def.isSystem },
      create: { tenantId, key: def.key, name: def.name, isSystem: def.isSystem },
    });
    rolesByKey[def.key] = role.id;
  }
  function roleId(key: string): string {
    const id = rolesByKey[key];
    if (!id) throw new Error(`[commerce-leads-fixtures] expected role "${key}" to exist`);
    return id;
  }

  // ── Permission grants — mirrors prisma/seed.ts's P2 matrix exactly ─────────────────
  // super_admin: full on everything (mirrors prisma/seed.ts super_admin/admin = scope all).
  for (const mod of P2_MODULES) {
    for (const action of P2_ACTIONS) {
      await grant(prisma, roleId("super_admin"), permId(p2Key(mod, action)), RolePermissionScope.all);
    }
  }

  // finance: full on orders/payments/invoices/refunds (incl. refunds.approve); coupons view/export only.
  for (const mod of ["orders", "payments", "invoices", "refunds"] as const) {
    for (const action of P2_ACTIONS) {
      if (action === "convert") continue; // convert is CRM-only
      await grant(prisma, roleId("finance"), permId(p2Key(mod, action)), RolePermissionScope.all);
    }
  }
  await grant(prisma, roleId("finance"), permId(p2Key("coupons", "view")), RolePermissionScope.all);
  await grant(prisma, roleId("finance"), permId(p2Key("coupons", "export")), RolePermissionScope.all);

  // marketing: full on coupons/leads/activities/bookings.
  for (const mod of ["coupons", "leads", "activities", "bookings"] as const) {
    for (const action of P2_ACTIONS) {
      await grant(prisma, roleId("marketing"), permId(p2Key(mod, action)), RolePermissionScope.all);
    }
  }

  // counsellor: own scope on leads/activities/bookings + leads.convert.
  const counsellorGrants: Array<[string, string]> = [
    ["leads", "view"],
    ["leads", "create"],
    ["leads", "edit"],
    ["leads", "convert"],
    ["activities", "view"],
    ["activities", "create"],
    ["activities", "edit"],
    ["bookings", "view"],
    ["bookings", "create"],
    ["bookings", "edit"],
  ];
  for (const [mod, action] of counsellorGrants) {
    await grant(prisma, roleId("counsellor"), permId(p2Key(mod, action)), RolePermissionScope.own);
  }

  // branch_manager: branch scope on orders/payments(view) + leads/activities/bookings.
  const branchManagerGrants: Array<[string, string]> = [
    ["orders", "view"],
    ["orders", "export"],
    ["payments", "view"],
    ["payments", "export"],
    ["leads", "view"],
    ["leads", "create"],
    ["leads", "edit"],
    ["leads", "export"],
    ["activities", "view"],
    ["activities", "create"],
    ["bookings", "view"],
    ["bookings", "create"],
  ];
  for (const [mod, action] of branchManagerGrants) {
    await grant(prisma, roleId("branch_manager"), permId(p2Key(mod, action)), RolePermissionScope.branch);
  }

  // ── Branches (2, for cross-branch isolation) ────────────────────────────────────────
  async function ensureBranch(name: string, city: string): Promise<{ id: string }> {
    const existing = await prisma.branch.findFirst({ where: { tenantId, name } });
    if (existing) return existing;
    return prisma.branch.create({ data: { tenantId, name, city, status: "active" } });
  }
  const branchA = await ensureBranch("QA CL Fixture Branch A", "Hyderabad");
  const branchB = await ensureBranch("QA CL Fixture Branch B", "Bengaluru");

  // ── Program + 2 batches ─────────────────────────────────────────────────────────────
  // NOTE: `programs.slug` has NO Prisma-level global @unique (dropped in migration
  // website_seo_slug_fix — it's a raw-SQL (tenant_id, slug) partial-unique WHERE
  // deleted_at IS NULL instead, per programs.repository conventions elsewhere in this
  // codebase). `prisma.program.upsert({ where: { slug } })` is therefore NOT a valid
  // Prisma unique selector — mirrors the `ensureBranch` find-then-create/update pattern
  // just above rather than a Prisma-level upsert.
  const programSlug = "qa-cl-fixture-program";
  const programPricePaise = 5_00_000; // ₹5,000.00 — chosen so pct/flat coupon math is unambiguous in tests.
  const existingProgram = await prisma.program.findFirst({ where: { tenantId, slug: programSlug } });
  const program = existingProgram
    ? await prisma.program.update({
        where: { id: existingProgram.id },
        data: { pricePaise: programPricePaise, status: "published" },
      })
    : await prisma.program.create({
        data: {
          tenantId,
          slug: programSlug,
          title: "QA CL Fixture Program",
          domain: "test",
          level: "beginner",
          mode: "hybrid",
          durationWeeks: 8,
          pricePaise: programPricePaise,
          currency: "INR",
          status: "published",
        },
      });

  async function ensureBatch(name: string, branchId: string): Promise<{ id: string }> {
    const existing = await prisma.batch.findFirst({ where: { tenantId, name } });
    if (existing) {
      return prisma.batch.update({ where: { id: existing.id }, data: { branchId, deletedAt: null, status: "active" } });
    }
    return prisma.batch.create({
      data: {
        tenantId,
        programId: program.id,
        branchId,
        name,
        startDate: new Date("2026-03-01"),
        capacity: 10,
        mode: "hybrid",
        schedule: [],
        status: "active",
      },
    });
  }
  const batchA = await ensureBatch("QA CL Fixture Batch A", branchA.id);
  const batchB = await ensureBatch("QA CL Fixture Batch B", branchB.id);

  // ── Users ────────────────────────────────────────────────────────────────────────────
  const superAdmin = await ensureUser(prisma, tenantId, CL_SUPER_ADMIN_EMAIL, CL_SUPER_ADMIN_PASSWORD, "QA CL Super Admin");
  await upsertUserRole(prisma, superAdmin.id, roleId("super_admin"), null);

  const finance = await ensureUser(prisma, tenantId, CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD, "QA CL Finance");
  await upsertUserRole(prisma, finance.id, roleId("finance"), null);

  const marketing = await ensureUser(prisma, tenantId, CL_MARKETING_EMAIL, CL_MARKETING_PASSWORD, "QA CL Marketing");
  await upsertUserRole(prisma, marketing.id, roleId("marketing"), null);

  const branchManager = await ensureUser(prisma, tenantId, CL_BRANCH_MANAGER_EMAIL, CL_BRANCH_MANAGER_PASSWORD, "QA CL Branch Manager");
  await upsertUserRole(prisma, branchManager.id, roleId("branch_manager"), branchA.id);

  const counsellorA = await ensureUser(prisma, tenantId, CL_COUNSELLOR_A_EMAIL, CL_COUNSELLOR_A_PASSWORD, "QA CL Counsellor A");
  await upsertUserRole(prisma, counsellorA.id, roleId("counsellor"), branchA.id);

  const counsellorB = await ensureUser(prisma, tenantId, CL_COUNSELLOR_B_EMAIL, CL_COUNSELLOR_B_PASSWORD, "QA CL Counsellor B");
  await upsertUserRole(prisma, counsellorB.id, roleId("counsellor"), branchB.id);

  const bareStudent = await ensureUser(prisma, tenantId, CL_BARE_STUDENT_EMAIL, CL_BARE_STUDENT_PASSWORD, "QA CL Bare Student");
  await upsertUserRole(prisma, bareStudent.id, roleId("student"), null);

  // ── One pre-existing enrollable student profile (FK target for direct order tests) ──
  const enrollableStudentUser = await ensureUser(
    prisma,
    tenantId,
    "qa-cl-enrollable-student@stimuliiq.test",
    "Qa-Cl-EnrollableStudent-123!",
    "QA CL Enrollable Student",
  );
  await upsertUserRole(prisma, enrollableStudentUser.id, roleId("student"), null);
  const enrollableStudentProfile = await prisma.studentProfile.upsert({
    where: { userId: enrollableStudentUser.id },
    update: { status: "active" },
    create: {
      tenantId,
      userId: enrollableStudentUser.id,
      college: "QA College",
      courseType: "btech",
      year: 2,
      city: "Hyderabad",
      source: "fixture",
      status: "active",
    },
  });

  return {
    tenantId,
    branchAId: branchA.id,
    branchBId: branchB.id,
    programId: program.id,
    programPricePaise,
    batchAId: batchA.id,
    batchBId: batchB.id,
    superAdminUserId: superAdmin.id,
    financeUserId: finance.id,
    marketingUserId: marketing.id,
    branchManagerUserId: branchManager.id,
    counsellorAUserId: counsellorA.id,
    counsellorBUserId: counsellorB.id,
    bareStudentUserId: bareStudent.id,
    enrollableStudentProfileId: enrollableStudentProfile.id,
  };
}

/**
 * Deletes only the rows THIS file creates, never the shared "stimuliiq" tenant/roles/
 * permission-catalog rows `prisma/seed.ts` or other fixture files may also have created.
 * Run in `afterAll`. Deletes in FK-safe order: refunds -> payments -> invoices -> orders
 * -> enrollments -> bookings -> activities -> leads -> coupons -> batches -> program ->
 * student profiles -> users -> branches.
 */
export async function teardownCommerceLeadsFixtures(prisma: PrismaClient, _tenantId: string): Promise<void> {
  const fixtureUsers = await prisma.user.findMany({
    where: { email: { in: [...ALL_FIXTURE_EMAILS, "qa-cl-enrollable-student@stimuliiq.test"] } },
    select: { id: true },
  });
  const userIds = fixtureUsers.map((u) => u.id);

  const studentProfiles = await prisma.studentProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const studentProfileIds = studentProfiles.map((s) => s.id);

  const fixtureProgram = await prisma.program.findFirst({ where: { slug: "qa-cl-fixture-program" }, select: { id: true } });
  const fixtureBatches = await prisma.batch.findMany({
    where: {
      OR: [
        { name: { in: ["QA CL Fixture Batch A", "QA CL Fixture Batch B"] } },
        ...(fixtureProgram ? [{ programId: fixtureProgram.id }] : []),
      ],
    },
    select: { id: true },
  });
  const batchIds = fixtureBatches.map((b) => b.id);

  // Orders for this program (covers orders created by students NOT in studentProfileIds too,
  // e.g. conversion-created students — matched by programId instead).
  const fixtureOrders = fixtureProgram
    ? await prisma.order.findMany({ where: { programId: fixtureProgram.id }, select: { id: true } })
    : [];
  const orderIds = fixtureOrders.map((o) => o.id);
  const fixturePayments = orderIds.length
    ? await prisma.payment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })
    : [];
  const paymentIds = fixturePayments.map((p) => p.id);

  if (paymentIds.length) await prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
  if (orderIds.length) {
    await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.enrollment.deleteMany({ where: { orderId: { in: orderIds } } });
  }
  if (studentProfileIds.length) await prisma.enrollment.deleteMany({ where: { studentId: { in: studentProfileIds } } });
  if (batchIds.length) await prisma.enrollment.deleteMany({ where: { batchId: { in: batchIds } } });
  if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  // Leads owned by fixture users, or any leads created against the fixture program.
  const fixtureLeads = await prisma.lead.findMany({
    where: {
      OR: [
        { ownerId: { in: userIds } },
        ...(fixtureProgram ? [{ programInterestId: fixtureProgram.id }] : []),
        { name: { startsWith: "QA CL " } },
      ],
    },
    select: { id: true },
  });
  const leadIds = fixtureLeads.map((l) => l.id);
  if (leadIds.length) {
    await prisma.booking.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.activity.deleteMany({ where: { leadId: { in: leadIds } } });
  }
  // Activities logged directly by fixture users (e.g. on converted students, no leadId).
  await prisma.activity.deleteMany({ where: { userId: { in: userIds } } });
  // Public-intake bookings created against fixture phone numbers used by the QA suite.
  await prisma.booking.deleteMany({
    where: { lead: { phone: { startsWith: "9" }, name: { startsWith: "QA Public" } } },
  });
  if (leadIds.length) await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });

  // Coupons created by this suite (named with the QA-CL prefix).
  await prisma.coupon.deleteMany({ where: { code: { startsWith: "QACL" } } });

  if (batchIds.length) await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  if (fixtureProgram) await prisma.program.deleteMany({ where: { id: fixtureProgram.id } });

  await prisma.studentProfile.deleteMany({ where: { id: { in: studentProfileIds } } });
  // Conversion-created student profiles (linked via leads.convertedStudentId, already
  // captured above before lead deletion would have nulled the relation) — also catch any
  // student users created with the QA conversion email pattern.
  const convertedStudentUsers = await prisma.user.findMany({
    where: { email: { contains: "qa-cl-converted-" } },
    select: { id: true },
  });
  const convertedUserIds = convertedStudentUsers.map((u) => u.id);
  if (convertedUserIds.length) {
    const convertedProfiles = await prisma.studentProfile.findMany({ where: { userId: { in: convertedUserIds } }, select: { id: true } });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: convertedProfiles.map((p) => p.id) } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: convertedUserIds } } });
  }

  await prisma.session.deleteMany({ where: { userId: { in: [...userIds, ...convertedUserIds] } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [...userIds, ...convertedUserIds] } } });
  await purgeAuditLogs(prisma, { actorId: { in: [...userIds, ...convertedUserIds] } });
  // Phase-9 Completion T31/R3: CommerceService.verifyPayment now calls
  // notifSvc.notifyPaymentReceipt(), which writes a `notifications` row for the payer —
  // must be cleaned up before deleting the user (FK) or teardown throws.
  await prisma.notification.deleteMany({ where: { userId: { in: [...userIds, ...convertedUserIds] } } });
  await prisma.notificationPref.deleteMany({ where: { userId: { in: [...userIds, ...convertedUserIds] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...userIds, ...convertedUserIds] } } });

  await prisma.branch.deleteMany({ where: { name: { in: ["QA CL Fixture Branch A", "QA CL Fixture Branch B"] } } });

  // Intentionally leave the shared tenant/roles/permission-catalog rows in place — see
  // crm-fixtures.ts's identical rationale.
}
