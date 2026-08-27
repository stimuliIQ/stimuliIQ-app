// apps/api/test/fixtures/crm-fixtures.ts
//
// Fixture factory for the P1 CRM-core integration suite (qa-engineer, Wave 5,
// docs/plans/phase-1.md task #8). Mirrors the SHAPE/conventions of
// test/fixtures/seed-fixtures.ts (Phase-0 auth/RBAC fixtures) but is scoped to exactly
// what the CRM integration tests need:
//   - reuses the shared "stimuliiq" tenant (same hard-coded-slug constraint as
//     seed-fixtures.ts — see that file's header for why; AuthService.login resolves
//     users via a hard-coded TENANT_SLUG, so every fixture user MUST live in that tenant)
//   - the full docs/03 §9 default role set, with the FULL P1 permission matrix
//     materialized exactly as prisma/seed.ts does it (branch_manager=branch,
//     counsellor=branch, faculty=assigned/own, content_editor=all, support=all-view)
//   - 2 branches (so branch-scope isolation has a SECOND branch to prove invisibility
//     against, independent of whatever prisma/seed.ts's dev seed has already created)
//   - 1 program (for batch creation FK validity)
//   - users with KNOWN passwords for every role this suite logs in as: super_admin,
//     branch_manager (branch A), counsellor (branch A), faculty (branch A, with their
//     own faculty_profiles row + an assigned batch), faculty (branch B, no assigned
//     batch — used for the negative "faculty can't see branch B's batch" cases), a
//     bare student (no role grants beyond `student`, used for the deny-by-default case)
//   - 2 batches (one per branch, one assigned to the branch-A faculty) +1 student
//     profile pre-enrolled in the branch-A batch, so list/roster/move/withdraw tests
//     have something real to operate on without every test having to create its own.
//
// Idempotent: every entity is upserted/found-or-created on a natural unique key, safe to
// call multiple times against the same database.
//
// IMPORTANT (same defect as seed-fixtures.ts, NOT fixed here — qa-engineer scope):
// `AuthService` hard-codes `TENANT_SLUG = "stimuliiq"` — every fixture user here is
// therefore created in that shared tenant, never an isolated per-suite tenant.

import { PrismaClient, RolePermissionScope } from "@prisma/client";
import { purgeAuditLogs } from "../../src/prisma/purge-audit-logs";
import { ensureFixtureCourseTypes } from "./course-type-fixtures";
import * as argon2 from "argon2";

export const CRM_TENANT_SLUG = "stimuliiq";

// ── Known credentials for every role this suite logs in as ──────────────────────────
export const SUPER_ADMIN_EMAIL = "qa-crm-superadmin@stimuliiq.test";
export const SUPER_ADMIN_PASSWORD = "Qa-Crm-SuperAdmin-123!";

export const BRANCH_MANAGER_EMAIL = "qa-crm-branchmgr@stimuliiq.test";
export const BRANCH_MANAGER_PASSWORD = "Qa-Crm-BranchMgr-123!";

export const COUNSELLOR_EMAIL = "qa-crm-counsellor@stimuliiq.test";
export const COUNSELLOR_PASSWORD = "Qa-Crm-Counsellor-123!";

export const FACULTY_A_EMAIL = "qa-crm-faculty-a@stimuliiq.test";
export const FACULTY_A_PASSWORD = "Qa-Crm-FacultyA-123!";

export const FACULTY_B_EMAIL = "qa-crm-faculty-b@stimuliiq.test";
export const FACULTY_B_PASSWORD = "Qa-Crm-FacultyB-123!";

export const BARE_STUDENT_EMAIL = "qa-crm-barestudent@stimuliiq.test";
export const BARE_STUDENT_PASSWORD = "Qa-Crm-BareStudent-123!";

// Narrow-scope role-editor — granted ONLY `roles.edit` at scope "branch" (never "all").
// Exists purely to exercise the privilege-escalation guard's "cannot grant a BROADER
// scope than your own" branch — super_admin/admin hold every permission at scope=all,
// so they can never trigger that branch (every grant they attempt is <= their own
// scope). See roles.service.ts's `updatePermissions()` SCOPE_RANK comparison.
export const NARROW_ROLE_EDITOR_EMAIL = "qa-crm-narrow-role-editor@stimuliiq.test";
export const NARROW_ROLE_EDITOR_PASSWORD = "Qa-Crm-NarrowRoleEditor-123!";

const ALL_FIXTURE_EMAILS = [
  SUPER_ADMIN_EMAIL,
  BRANCH_MANAGER_EMAIL,
  COUNSELLOR_EMAIL,
  FACULTY_A_EMAIL,
  FACULTY_B_EMAIL,
  BARE_STUDENT_EMAIL,
  NARROW_ROLE_EDITOR_EMAIL,
];

export interface SeededCrmFixtures {
  tenantId: string;
  branchAId: string;
  branchBId: string;
  programId: string;
  superAdminUserId: string;
  branchManagerUserId: string;
  counsellorUserId: string;
  facultyAUserId: string;
  facultyAProfileId: string;
  facultyBUserId: string;
  facultyBProfileId: string;
  bareStudentUserId: string;
  narrowRoleEditorUserId: string;
  narrowRoleEditorRoleId: string;
  batchAId: string;
  batchBId: string;
  seededStudentProfileId: string;
  seededStudentUserId: string;
  rolesByKey: Record<string, string>;
}

const P1_MODULES = ["students", "faculty", "courses", "batches", "enrollments", "roles", "branches", "audit_logs"] as const;
const P1_ACTIONS = ["view", "create", "edit", "delete", "export", "approve"] as const;

function p1Key(mod: string, action: string): string {
  return `${mod}.${action}`;
}

async function ensurePermissionCatalog(prisma: PrismaClient): Promise<Map<string, { id: string }>> {
  const catalog: Array<{ key: string; label: string }> = [];
  for (const mod of P1_MODULES) {
    for (const action of P1_ACTIONS) {
      catalog.push({ key: p1Key(mod, action), label: `${action} ${mod}` });
    }
  }
  const permissions = await Promise.all(
    catalog.map((perm) =>
      prisma.permission.upsert({ where: { key: perm.key }, update: {}, create: perm }),
    ),
  );
  return new Map(permissions.map((p) => [p.key, { id: p.id }]));
}

async function grant(
  prisma: PrismaClient,
  roleId: string,
  permissionId: string,
  scope: RolePermissionScope,
): Promise<void> {
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

async function ensureUser(
  prisma: PrismaClient,
  tenantId: string,
  email: string,
  password: string,
  name: string,
): Promise<{ id: string }> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { tenantId_email: { tenantId, email } },
    update: { passwordHash, status: "active" },
    create: { tenantId, email, name, passwordHash, status: "active" },
  });
}

/**
 * Seeds the full P1 CRM-core fixture set documented in the file header. Safe to call
 * multiple times against the same database (upserts on natural keys).
 */
export async function seedCrmFixtures(prisma: PrismaClient): Promise<SeededCrmFixtures> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: CRM_TENANT_SLUG },
    update: {},
    create: { slug: CRM_TENANT_SLUG, name: "QA Integration Tenant", status: "active", settings: {}, branding: {} },
  });
  const tenantId = tenant.id;

  // Course types are CRM-managed rows (ADR-0068): the API rejects a student or a lead
  // conversion whose course-type key is not one of the tenant's active options.
  await ensureFixtureCourseTypes(prisma, tenantId);

  const permByKey = await ensurePermissionCatalog(prisma);
  function permId(key: string): string {
    const perm = permByKey.get(key);
    if (!perm) throw new Error(`[crm-fixtures] expected permission "${key}" to exist`);
    return perm.id;
  }

  // ── Roles (full docs/03 §9 default set, idempotent) ────────────────────────────────
  const roleDefs = [
    { key: "super_admin", name: "Super Admin", isSystem: true },
    { key: "admin", name: "Admin", isSystem: true },
    { key: "branch_manager", name: "Branch Manager", isSystem: false },
    { key: "counsellor", name: "Counsellor", isSystem: false },
    { key: "faculty", name: "Faculty", isSystem: false },
    { key: "finance", name: "Finance", isSystem: false },
    { key: "marketing", name: "Marketing", isSystem: false },
    { key: "support", name: "Support", isSystem: false },
    { key: "content_editor", name: "Content Editor", isSystem: false },
    { key: "student", name: "Student", isSystem: false },
  ] as const;

  const roles = await Promise.all(
    roleDefs.map((def) =>
      prisma.role.upsert({
        where: { tenantId_key: { tenantId, key: def.key } },
        update: { name: def.name, isSystem: def.isSystem },
        create: { tenantId, key: def.key, name: def.name, isSystem: def.isSystem },
      }),
    ),
  );
  const rolesByKey: Record<string, string> = {};
  for (const role of roles) rolesByKey[role.key] = role.id;

  function roleId(key: string): string {
    const id = rolesByKey[key];
    if (!id) throw new Error(`[crm-fixtures] expected role "${key}" to exist`);
    return id;
  }

  // ── Permission grants — mirrors prisma/seed.ts exactly ─────────────────────────────
  for (const role of [roles.find((r) => r.key === "super_admin")!, roles.find((r) => r.key === "admin")!]) {
    await Promise.all(
      [...permByKey.entries()].map(([key, { id }]) => grant(prisma, role.id, id, RolePermissionScope.all)),
    );
  }

  const branchManagerGrants: Array<[string, string]> = [
    ["students", "view"], ["students", "create"], ["students", "edit"], ["students", "delete"], ["students", "export"],
    ["faculty", "view"], ["faculty", "create"], ["faculty", "edit"], ["faculty", "delete"],
    ["courses", "view"],
    ["batches", "view"], ["batches", "create"], ["batches", "edit"], ["batches", "delete"],
    ["enrollments", "view"], ["enrollments", "create"], ["enrollments", "edit"],
  ];
  await Promise.all(
    branchManagerGrants.map(([mod, action]) => grant(prisma, roleId("branch_manager"), permId(p1Key(mod, action)), RolePermissionScope.branch)),
  );

  const counsellorGrants: Array<[string, string]> = [
    ["students", "view"], ["students", "edit"], ["students", "create"],
    ["courses", "view"],
  ];
  await Promise.all(
    counsellorGrants.map(([mod, action]) => grant(prisma, roleId("counsellor"), permId(p1Key(mod, action)), RolePermissionScope.branch)),
  );

  const facultyAssignedGrants: Array<[string, string]> = [
    ["students", "view"],
    ["batches", "view"], ["batches", "edit"],
    ["enrollments", "view"], ["enrollments", "create"], ["enrollments", "edit"],
  ];
  await Promise.all(
    facultyAssignedGrants.map(([mod, action]) => grant(prisma, roleId("faculty"), permId(p1Key(mod, action)), RolePermissionScope.assigned)),
  );
  const facultySelfGrants: Array<[string, string]> = [["faculty", "view"], ["faculty", "edit"]];
  await Promise.all(
    facultySelfGrants.map(([mod, action]) => grant(prisma, roleId("faculty"), permId(p1Key(mod, action)), RolePermissionScope.own)),
  );
  const facultyCourseAuthorGrants: Array<[string, string]> = [["courses", "view"], ["courses", "create"], ["courses", "edit"]];
  await Promise.all(
    facultyCourseAuthorGrants.map(([mod, action]) => grant(prisma, roleId("faculty"), permId(p1Key(mod, action)), RolePermissionScope.assigned)),
  );

  await grant(prisma, roleId("support"), permId(p1Key("students", "view")), RolePermissionScope.all);

  const contentEditorGrants: Array<[string, string]> = [
    ["courses", "view"], ["courses", "create"], ["courses", "edit"], ["courses", "delete"], ["courses", "approve"],
  ];
  await Promise.all(
    contentEditorGrants.map(([mod, action]) => grant(prisma, roleId("content_editor"), permId(p1Key(mod, action)), RolePermissionScope.all)),
  );

  // ── Branches (2, for cross-branch isolation tests) ─────────────────────────────────
  async function ensureBranch(name: string, city: string): Promise<{ id: string }> {
    const existing = await prisma.branch.findFirst({ where: { tenantId, name } });
    if (existing) return existing;
    return prisma.branch.create({ data: { tenantId, name, city, status: "active" } });
  }
  const branchA = await ensureBranch("QA Fixture Branch A", "Hyderabad");
  const branchB = await ensureBranch("QA Fixture Branch B", "Bengaluru");

  // ── Program (FK target for batches) ────────────────────────────────────────────────
  // NOTE: `programs.slug` has NO Prisma-level global @unique (raw-SQL (tenant_id, slug)
  // partial-unique instead — see commerce-leads-fixtures.ts's comment on the same
  // pattern) — `upsert({ where: { slug } })` is not a valid Prisma selector; find-then-
  // create instead.
  const programSlug = "qa-crm-fixture-program";
  const existingProgram = await prisma.program.findFirst({ where: { tenantId, slug: programSlug } });
  const program =
    existingProgram ??
    (await prisma.program.create({
      data: {
        tenantId,
        slug: programSlug,
        title: "QA Fixture Program",
        domain: "test",
        level: "beginner",
        mode: "hybrid",
        durationWeeks: 8,
        pricePaise: 100000,
        currency: "INR",
        status: "published",
      },
    }));

  // ── Users (known passwords) ────────────────────────────────────────────────────────
  const superAdmin = await ensureUser(prisma, tenantId, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, "QA CRM Super Admin");
  await upsertUserRole(prisma, superAdmin.id, roleId("super_admin"), null);

  const branchManager = await ensureUser(prisma, tenantId, BRANCH_MANAGER_EMAIL, BRANCH_MANAGER_PASSWORD, "QA CRM Branch Manager");
  await upsertUserRole(prisma, branchManager.id, roleId("branch_manager"), branchA.id);

  const counsellor = await ensureUser(prisma, tenantId, COUNSELLOR_EMAIL, COUNSELLOR_PASSWORD, "QA CRM Counsellor");
  await upsertUserRole(prisma, counsellor.id, roleId("counsellor"), branchA.id);

  const facultyAUser = await ensureUser(prisma, tenantId, FACULTY_A_EMAIL, FACULTY_A_PASSWORD, "QA CRM Faculty A");
  await upsertUserRole(prisma, facultyAUser.id, roleId("faculty"), branchA.id);
  const facultyAProfile = await prisma.facultyProfile.upsert({
    where: { userId: facultyAUser.id },
    update: { branchId: branchA.id },
    create: { tenantId, userId: facultyAUser.id, expertise: ["Testing"], branchId: branchA.id },
  });

  const facultyBUser = await ensureUser(prisma, tenantId, FACULTY_B_EMAIL, FACULTY_B_PASSWORD, "QA CRM Faculty B");
  await upsertUserRole(prisma, facultyBUser.id, roleId("faculty"), branchB.id);
  const facultyBProfile = await prisma.facultyProfile.upsert({
    where: { userId: facultyBUser.id },
    update: { branchId: branchB.id },
    create: { tenantId, userId: facultyBUser.id, expertise: ["Testing"], branchId: branchB.id },
  });

  const bareStudent = await ensureUser(prisma, tenantId, BARE_STUDENT_EMAIL, BARE_STUDENT_PASSWORD, "QA CRM Bare Student");
  await upsertUserRole(prisma, bareStudent.id, roleId("student"), null);

  // ── Custom narrow-scope role-editor (privilege-escalation guard test fixture) ──────
  const narrowRoleEditorRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId, key: "qa_narrow_role_editor" } },
    update: {},
    create: { tenantId, key: "qa_narrow_role_editor", name: "QA Narrow Role Editor", isSystem: false },
  });
  await grant(prisma, narrowRoleEditorRole.id, permId("roles.edit"), RolePermissionScope.branch);
  await grant(prisma, narrowRoleEditorRole.id, permId("roles.view"), RolePermissionScope.branch);
  // Deliberately NOT granted students.* at all — used to prove the "editor doesn't hold
  // this key at all" rejection branch as well as the "broader scope" branch.
  const narrowRoleEditorUser = await ensureUser(
    prisma,
    tenantId,
    NARROW_ROLE_EDITOR_EMAIL,
    NARROW_ROLE_EDITOR_PASSWORD,
    "QA Narrow Role Editor",
  );
  await upsertUserRole(prisma, narrowRoleEditorUser.id, narrowRoleEditorRole.id, branchA.id);

  // ── Batches (one per branch; branch A's batch assigned to faculty A) ──────────────
  async function ensureBatch(name: string, branchId: string, facultyId: string | null): Promise<{ id: string }> {
    const existing = await prisma.batch.findFirst({ where: { tenantId, name } });
    if (existing) {
      return prisma.batch.update({ where: { id: existing.id }, data: { branchId, facultyId, deletedAt: null } });
    }
    return prisma.batch.create({
      data: {
        tenantId,
        programId: program.id,
        branchId,
        facultyId,
        name,
        startDate: new Date("2026-01-01"),
        capacity: 10,
        mode: "hybrid",
        schedule: [],
        status: "active",
      },
    });
  }
  const batchA = await ensureBatch("QA Fixture Batch A", branchA.id, facultyAProfile.id);
  const batchB = await ensureBatch("QA Fixture Batch B", branchB.id, facultyBProfile.id);

  // ── One pre-enrolled student in batch A (for roster/list/move/withdraw tests) ──────
  const seededStudentUser = await ensureUser(
    prisma,
    tenantId,
    "qa-crm-seeded-student@stimuliiq.test",
    "Qa-Crm-SeededStudent-123!",
    "QA CRM Seeded Student",
  );
  await upsertUserRole(prisma, seededStudentUser.id, roleId("student"), null);
  const seededStudentProfile = await prisma.studentProfile.upsert({
    where: { userId: seededStudentUser.id },
    update: { status: "active" },
    create: {
      tenantId,
      userId: seededStudentUser.id,
      college: "QA College",
      courseType: "btech",
      year: 2,
      city: "Hyderabad",
      source: "fixture",
      status: "active",
    },
  });
  const existingEnrollment = await prisma.enrollment.findFirst({
    where: { tenantId, studentId: seededStudentProfile.id, batchId: batchA.id },
  });
  if (!existingEnrollment) {
    await prisma.enrollment.create({
      data: {
        tenantId,
        studentId: seededStudentProfile.id,
        batchId: batchA.id,
        programId: program.id,
        status: "active",
        progressPct: 10,
      },
    });
  } else if (existingEnrollment.deletedAt) {
    await prisma.enrollment.update({ where: { id: existingEnrollment.id }, data: { deletedAt: null, status: "active" } });
  }

  return {
    tenantId,
    branchAId: branchA.id,
    branchBId: branchB.id,
    programId: program.id,
    superAdminUserId: superAdmin.id,
    branchManagerUserId: branchManager.id,
    counsellorUserId: counsellor.id,
    facultyAUserId: facultyAUser.id,
    facultyAProfileId: facultyAProfile.id,
    facultyBUserId: facultyBUser.id,
    facultyBProfileId: facultyBProfile.id,
    bareStudentUserId: bareStudent.id,
    narrowRoleEditorUserId: narrowRoleEditorUser.id,
    narrowRoleEditorRoleId: narrowRoleEditorRole.id,
    batchAId: batchA.id,
    batchBId: batchB.id,
    seededStudentProfileId: seededStudentProfile.id,
    seededStudentUserId: seededStudentUser.id,
    rolesByKey,
  };
}

/**
 * Seeds a PAID order for (student, program) — the ENTITLEMENT precondition the enrollment
 * endpoint now requires (a student may only be enrolled into a batch whose program they
 * have paid for). Integration tests that exercise the manual enroll happy-path must call
 * this first, mirroring the real "checkout → paid order → enroll" funnel. Idempotency-key
 * is derived from (student, program) so repeat calls in a run don't collide.
 */
export async function seedPaidOrder(
  prisma: PrismaClient,
  args: { tenantId: string; studentId: string; programId: string; amountPaise?: number },
): Promise<{ id: string }> {
  return prisma.order.create({
    data: {
      tenantId: args.tenantId,
      studentId: args.studentId,
      programId: args.programId,
      amountPaise: args.amountPaise ?? 100000,
      currency: "INR",
      status: "paid",
      idempotencyKey: `qa-paid-order-${args.studentId}-${args.programId}`,
    },
    select: { id: true },
  });
}

/**
 * Deletes only the rows THIS file creates (by fixture-specific QA emails / fixture
 * branch+program names), never the shared "stimuliiq" tenant/roles/permission-catalog
 * rows `prisma/seed.ts` may also have created. Run in `afterAll`.
 */
export async function teardownCrmFixtures(prisma: PrismaClient, _tenantId: string): Promise<void> {
  const fixtureUsers = await prisma.user.findMany({
    where: {
      email: { in: [...ALL_FIXTURE_EMAILS, "qa-crm-seeded-student@stimuliiq.test"] },
    },
    select: { id: true },
  });
  const userIds = fixtureUsers.map((u) => u.id);

  const studentProfiles = await prisma.studentProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const facultyProfiles = await prisma.facultyProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const studentProfileIds = studentProfiles.map((s) => s.id);
  const facultyProfileIds = facultyProfiles.map((f) => f.id);

  await prisma.enrollment.deleteMany({ where: { studentId: { in: studentProfileIds } } });

  // Match by FK to the fixture program (not just the two named "QA Fixture Batch A/B"
  // rows) so any extra batch a spec file creates directly via the API against
  // `fixtures.programId` (e.g. crm-batches-enrollments.integration-spec.ts's "POST
  // /crm/batches creates a batch" CRUD test, named `QA CRUD Batch ${Date.now()}`) is
  // also cleaned up here — otherwise `program.deleteMany` below violates
  // `batches_program_id_fkey` on every subsequent integration run sharing this fixture
  // program, since soft-deleted batch rows still hold a live FK to the program.
  const fixtureProgramForCleanup = await prisma.program.findFirst({
    where: { slug: "qa-crm-fixture-program" },
    select: { id: true },
  });
  // Paid orders seeded by seedPaidOrder() (the enrollment entitlement precondition) hold a
  // live FK to both the fixture program and API-created students — delete them before the
  // program/student deletes below, or `program.deleteMany` FK-fails on re-runs. Bare orders
  // (no payment/invoice children are seeded), so a flat deleteMany is sufficient.
  if (fixtureProgramForCleanup) {
    await prisma.order.deleteMany({ where: { programId: fixtureProgramForCleanup.id } });
  }
  const fixtureBatches = await prisma.batch.findMany({
    where: {
      OR: [
        { name: { in: ["QA Fixture Batch A", "QA Fixture Batch B"] } },
        ...(fixtureProgramForCleanup ? [{ programId: fixtureProgramForCleanup.id }] : []),
      ],
    },
    select: { id: true },
  });
  await prisma.enrollment.deleteMany({ where: { batchId: { in: fixtureBatches.map((b) => b.id) } } });
  await prisma.batch.deleteMany({ where: { id: { in: fixtureBatches.map((b) => b.id) } } });

  await prisma.studentProfile.deleteMany({ where: { id: { in: studentProfileIds } } });
  await prisma.facultyProfile.deleteMany({ where: { id: { in: facultyProfileIds } } });

  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await purgeAuditLogs(prisma, { actorId: { in: userIds } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await prisma.program.deleteMany({ where: { slug: "qa-crm-fixture-program" } });
  await prisma.branch.deleteMany({ where: { name: { in: ["QA Fixture Branch A", "QA Fixture Branch B"] } } });

  const narrowRole = await prisma.role.findFirst({ where: { key: "qa_narrow_role_editor" } });
  if (narrowRole) {
    await prisma.rolePermission.deleteMany({ where: { roleId: narrowRole.id } });
    await prisma.role.deleteMany({ where: { id: narrowRole.id } });
  }

  // Intentionally leave the shared tenant/roles/permission-catalog rows in place — they
  // are upserted (idempotent) on every run and match what prisma/seed.ts itself would
  // create, so leaving them is harmless and avoids deleting a real dev admin's role
  // grants out from under them.
}
