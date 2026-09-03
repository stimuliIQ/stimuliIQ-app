// apps/api/test/fixtures/seed-fixtures.ts
//
// Minimal, idempotent fixture factory for integration tests (qa-engineer, Wave 5,
// docs/plans/phase-0.md task #10). Mirrors the SHAPE of `prisma/seed.ts` (same tenant
// slug convention, same role/permission grant pattern) but is deliberately a separate,
// smaller implementation scoped to exactly what the auth/RBAC integration suite needs:
//   - one tenant
//   - the `audit_log.list` permission (the one permission/route the Phase-0 RBAC slice
//     proves end-to-end via GET /me/audit-sample)
//   - four roles: super_admin/admin (granted audit_log.list @ scope=all, matching
//     prisma/seed.ts), faculty/student (NOT granted — proves deny-by-default/403)
//   - one admin user (password known to the test) and one faculty user (password known
//     to the test), so the suite can log in as each and assert 200 vs 403.
//
// IMPORTANT (defect flagged for backend-builder, NOT fixed here per qa-engineer scope):
// `AuthService` hard-codes `TENANT_SLUG = "stimuliiq"` (auth.service.ts:37) for every
// login/refresh/otp lookup — there is currently NO way to authenticate a user attached
// to any other tenant, even though `users`/`roles` are tenant-scoped in the schema. This
// fixture file is therefore FORCED to reuse the literal "stimuliiq" tenant slug (the same
// one `prisma/seed.ts` creates) rather than an isolated per-suite tenant, so this test's
// own users resolve through `AuthService.login`'s hard-coded lookup. Every row this file
// creates is still deleted in `teardownFixtures()`; only the TENANT row itself is shared
// with `prisma/seed.ts` (upserted, never deleted, so re-running this suite never wipes
// the dev-seeded tenant/admin out from under a developer).

import { PrismaClient, RolePermissionScope } from "@prisma/client";
import * as argon2 from "argon2";
import { purgeAuditLogs } from "../../src/prisma/purge-audit-logs";

export const FIXTURE_TENANT_SLUG = "stimuliiq";
export const ADMIN_EMAIL = "qa-admin@stimuliiq.test";
export const ADMIN_PASSWORD = "Qa-Admin-Password-123!";
export const FACULTY_EMAIL = "qa-faculty@stimuliiq.test";
export const FACULTY_PASSWORD = "Qa-Faculty-Password-123!";
export const STUDENT_EMAIL = "qa-student@stimuliiq.test";
export const STUDENT_PASSWORD = "Qa-Student-Password-123!";

export interface SeededFixtures {
  tenantId: string;
  adminUserId: string;
  facultyUserId: string;
  studentUserId: string;
}

/**
 * Creates the tenant + roles + the `audit_log.list` permission + role grants + three
 * users (admin/faculty/student) needed by the integration suite. Safe to call multiple
 * times against the same database (upserts on natural keys) — does NOT touch
 * `prisma/seed.ts`'s own "stimuliiq" tenant.
 */
export async function seedFixtures(prisma: PrismaClient): Promise<SeededFixtures> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: FIXTURE_TENANT_SLUG },
    update: {},
    create: { slug: FIXTURE_TENANT_SLUG, name: "QA Integration Tenant", status: "active", settings: {}, branding: {} },
  });

  const auditLogList = await prisma.permission.upsert({
    where: { key: "audit_log.list" },
    update: {},
    create: { key: "audit_log.list", label: "List Audit Log" },
  });

  const roleDefs = [
    { key: "super_admin", name: "Super Admin", isSystem: true, grantAuditLogList: true },
    { key: "admin", name: "Admin", isSystem: true, grantAuditLogList: true },
    { key: "faculty", name: "Faculty", isSystem: false, grantAuditLogList: false },
    { key: "student", name: "Student", isSystem: false, grantAuditLogList: false },
  ] as const;

  const roles = await Promise.all(
    roleDefs.map((def) =>
      prisma.role.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: def.key } },
        update: {},
        create: { tenantId: tenant.id, key: def.key, name: def.name, isSystem: def.isSystem },
      }),
    ),
  );

  await Promise.all(
    roleDefs
      .filter((def) => def.grantAuditLogList)
      .map((def) => {
        const role = roles.find((r) => r.key === def.key);
        if (!role) throw new Error(`[fixtures] expected role ${def.key} to exist`);
        return prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: auditLogList.id } },
          update: { scope: RolePermissionScope.all },
          create: { roleId: role.id, permissionId: auditLogList.id, scope: RolePermissionScope.all },
        });
      }),
  );

  const adminRole = roles.find((r) => r.key === "admin");
  const facultyRole = roles.find((r) => r.key === "faculty");
  const studentRole = roles.find((r) => r.key === "student");
  if (!adminRole || !facultyRole || !studentRole) {
    throw new Error("[fixtures] expected admin/faculty/student roles to exist");
  }

  const adminUser = await upsertUser(prisma, tenant.id, ADMIN_EMAIL, ADMIN_PASSWORD, "QA Admin");
  const facultyUser = await upsertUser(prisma, tenant.id, FACULTY_EMAIL, FACULTY_PASSWORD, "QA Faculty");
  const studentUser = await upsertUser(prisma, tenant.id, STUDENT_EMAIL, STUDENT_PASSWORD, "QA Student");

  await upsertUserRole(prisma, adminUser.id, adminRole.id);
  await upsertUserRole(prisma, facultyUser.id, facultyRole.id);
  await upsertUserRole(prisma, studentUser.id, studentRole.id);

  return {
    tenantId: tenant.id,
    adminUserId: adminUser.id,
    facultyUserId: facultyUser.id,
    studentUserId: studentUser.id,
  };
}

/**
 * Deletes only the rows THIS file creates (by the fixture-specific QA emails), never the
 * shared "stimuliiq" tenant/roles/permission-catalog rows `prisma/seed.ts` may also have
 * created — re-running this suite against a dev DB that has already been `pnpm db:seed`'d
 * must never wipe out the real seeded admin or role/permission catalog. Run in `afterAll`.
 */
export async function teardownFixtures(prisma: PrismaClient, _tenantId: string): Promise<void> {
  const fixtureUsers = await prisma.user.findMany({
    where: { email: { in: [ADMIN_EMAIL, FACULTY_EMAIL, STUDENT_EMAIL] } },
    select: { id: true },
  });
  const userIds = fixtureUsers.map((u) => u.id);

  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await purgeAuditLogs(prisma, { actorId: { in: userIds } });
  // Gamification rows FK to `users`, and lesson completion now writes them.
  await prisma.pointsLedger.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.userBadge.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  // Intentionally leave the audit_log.list permission + role grants + the shared
  // "stimuliiq" tenant/roles in place — they are upserted (idempotent) on every run and
  // match what `prisma/seed.ts` itself would create, so leaving them is harmless and
  // avoids any risk of deleting a real dev admin's role grants out from under them.
}

async function upsertUser(prisma: PrismaClient, tenantId: string, email: string, password: string, name: string) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { tenantId_email: { tenantId, email } },
    update: { passwordHash, status: "active" },
    create: { tenantId, email, name, passwordHash, status: "active" },
  });
}

async function upsertUserRole(prisma: PrismaClient, userId: string, roleId: string): Promise<void> {
  const existing = await prisma.userRole.findFirst({ where: { userId, roleId, branchId: null } });
  if (!existing) {
    await prisma.userRole.create({ data: { userId, roleId, branchId: null } });
  }
}
